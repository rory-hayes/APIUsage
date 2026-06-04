import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildStorageKey,
  createUploadTaskComment,
  createUploadDownloadToken,
  createUploadRecord,
  getUploadChecklist,
  getWorkspaceRecurringUploadChecklist,
  getWorkspaceUploadChecklist,
  JsonUploadTaskCommentStore,
  JsonUploadStore,
  LocalUploadStorage,
  REQUIRED_UPLOAD_CATEGORIES,
  reviewUploadRecord,
  verifyUploadDownloadToken,
} from './uploads'
import { createAuditWorkspace, createAuditWorkspacePeriod } from './workspaces'

describe('audit upload workflow', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-uploads-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates upload metadata in needs_review state with source file evidence fields', () => {
    const uploadedAt = new Date('2026-06-01T10:00:00.000Z')

    const record = createUploadRecord(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'stripe_invoices_export',
        filename: 'stripe-invoices-may.csv',
        byteSize: 42_000,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_001/stripe-invoices-may.csv',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    )

    expect(record).toMatchObject({
      id: 'upl_workspace_001_stripe_invoices_export_stripe_invoices_may_csv',
      status: 'needs_review',
      sourceFileId: 'src_upl_workspace_001_stripe_invoices_export_stripe_invoices_may_csv',
      uploadedAt: uploadedAt.toISOString(),
    })
  })

  it('builds checklist status from upload records and keeps required missing categories visible', () => {
    const acceptedContract = reviewUploadRecord(
      createUploadRecord({
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'contracts_order_forms',
        filename: 'acme-order-form.pdf',
        byteSize: 1024,
        contentType: 'application/pdf',
        storageKey: 'workspaces/workspace_001/acme-order-form.pdf',
        uploadedBy: 'user_finance',
      }),
      { status: 'accepted', reviewedBy: 'internal_admin', reviewNote: 'Matches signed May terms.' },
      new Date('2026-06-01T11:00:00.000Z'),
    )

    const pendingUsage = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage-may.csv',
      byteSize: 2048,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_001/usage-may.csv',
      uploadedBy: 'user_engineering',
    })

    const checklist = getUploadChecklist([acceptedContract, pendingUsage])

    expect(checklist.find((item) => item.category === 'contracts_order_forms')).toMatchObject({
      files: 1,
      status: 'accepted',
    })
    expect(checklist.find((item) => item.category === 'usage_csv')).toMatchObject({
      files: 1,
      status: 'needs_review',
    })
    expect(checklist.find((item) => item.category === 'provider_cost_csv')).toMatchObject({
      files: 0,
      status: 'missing',
    })
    expect(checklist).toHaveLength(REQUIRED_UPLOAD_CATEGORIES.length)
  })

  it('builds a checklist from only the selected workspace records', () => {
    const acceptedAcmeContract = reviewUploadRecord(
      createUploadRecord({
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'contracts_order_forms',
        filename: 'acme-order-form.pdf',
        byteSize: 1024,
        contentType: 'application/pdf',
        storageKey: 'workspaces/workspace_acme_may_2026/contracts_order_forms/acme-order-form.pdf',
        uploadedBy: 'user_finance',
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )
    const northstarUsage = createUploadRecord({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      category: 'usage_csv',
      filename: 'northstar-usage-june.csv',
      byteSize: 2048,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage-june.csv',
      uploadedBy: 'user_engineering',
    })

    const checklist = getWorkspaceUploadChecklist([acceptedAcmeContract, northstarUsage], 'workspace_northstar_june_2026')

    expect(checklist.find((item) => item.category === 'contracts_order_forms')).toMatchObject({
      files: 0,
      status: 'missing',
      latestUpload: undefined,
    })
    expect(checklist.find((item) => item.category === 'usage_csv')).toMatchObject({
      files: 1,
      status: 'needs_review',
      latestUpload: expect.objectContaining({
        filename: 'northstar-usage-june.csv',
        workspaceId: 'workspace_northstar_june_2026',
      }),
    })
  })

  it('resets monthly upload categories while rolling forward reusable source files for the active period', () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_acme_monitoring',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'Revenue monitoring',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        monitoringPeriods: [
          createAuditWorkspacePeriod({
            label: 'May 2026',
            periodStart: '2026-05-01',
            periodEnd: '2026-05-31',
            status: 'closed',
          }),
          createAuditWorkspacePeriod({
            label: 'June 2026',
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            status: 'active',
          }),
        ],
        status: 'uploads',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const mayContract = reviewUploadRecord(
      createUploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'contracts_order_forms',
        filename: 'acme-order-form-may.pdf',
        byteSize: 1024,
        contentType: 'application/pdf',
        storageKey: 'workspaces/workspace_acme_monitoring/contracts/acme-order-form-may.pdf',
        uploadedBy: 'user_finance',
        metadata: {
          monitoringPeriodId: 'period_may_2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          periodLabel: 'May 2026',
        },
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )
    const mayUsage = reviewUploadRecord(
      createUploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'usage_csv',
        filename: 'usage-may.csv',
        byteSize: 2048,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_monitoring/usage/usage-may.csv',
        uploadedBy: 'user_engineering',
        metadata: {
          monitoringPeriodId: 'period_may_2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          periodLabel: 'May 2026',
        },
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )

    const checklist = getWorkspaceRecurringUploadChecklist([mayContract, mayUsage], workspace)

    expect(checklist.find((item) => item.category === 'contracts_order_forms')).toMatchObject({
      files: 1,
      status: 'accepted',
      latestUpload: expect.objectContaining({ filename: 'acme-order-form-may.pdf' }),
      periodLabel: 'June 2026',
      periodScope: 'rolled_forward',
      rollsForward: true,
    })
    expect(checklist.find((item) => item.category === 'usage_csv')).toMatchObject({
      files: 0,
      status: 'missing',
      latestUpload: undefined,
      periodLabel: 'June 2026',
      periodScope: 'current_period',
      rollsForward: false,
    })
  })

  it('tracks and compares multiple versions within each workspace upload category', () => {
    const firstUsage = reviewUploadRecord(
      createUploadRecord(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_001',
          category: 'usage_csv',
          filename: 'usage-v1.csv',
          byteSize: 1024,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_001/usage_csv/usage-v1.csv',
          checksum: 'a'.repeat(64),
          uploadedBy: 'user_engineering',
        },
        new Date('2026-06-01T09:00:00.000Z'),
      ),
      { status: 'accepted', reviewedBy: 'internal_admin' },
      new Date('2026-06-01T10:00:00.000Z'),
    )
    const duplicateUsage = reviewUploadRecord(
      createUploadRecord(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_001',
          category: 'usage_csv',
          filename: 'usage-v2-copy.csv',
          byteSize: 1024,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_001/usage_csv/usage-v2-copy.csv',
          checksum: 'a'.repeat(64),
          uploadedBy: 'user_engineering',
        },
        new Date('2026-06-01T11:00:00.000Z'),
      ),
      { status: 'duplicate', reviewedBy: 'internal_admin' },
      new Date('2026-06-01T11:30:00.000Z'),
    )
    const correctedUsage = createUploadRecord(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        filename: 'usage-v3-corrected.csv',
        byteSize: 1536,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_001/usage_csv/usage-v3-corrected.csv',
        checksum: 'b'.repeat(64),
        uploadedBy: 'user_engineering',
      },
      new Date('2026-06-01T12:00:00.000Z'),
    )
    const otherWorkspaceUsage = createUploadRecord(
      {
        organizationId: 'org_002',
        workspaceId: 'workspace_002',
        category: 'usage_csv',
        filename: 'other-workspace-usage.csv',
        byteSize: 4096,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_002/usage_csv/other-workspace-usage.csv',
        checksum: 'c'.repeat(64),
        uploadedBy: 'user_other',
      },
      new Date('2026-06-01T12:30:00.000Z'),
    )

    const checklist = getWorkspaceUploadChecklist(
      [otherWorkspaceUsage, duplicateUsage, correctedUsage, firstUsage],
      'workspace_001',
    )

    expect(checklist.find((item) => item.category === 'usage_csv')).toMatchObject({
      files: 3,
      latestUpload: expect.objectContaining({ filename: 'usage-v3-corrected.csv' }),
      versions: [
        {
          version: 3,
          uploadId: correctedUsage.id,
          filename: 'usage-v3-corrected.csv',
          isLatest: true,
          changedFromPrevious: true,
          byteDeltaFromPrevious: 512,
          previousUploadId: duplicateUsage.id,
        },
        {
          version: 2,
          uploadId: duplicateUsage.id,
          filename: 'usage-v2-copy.csv',
          isLatest: false,
          changedFromPrevious: false,
          byteDeltaFromPrevious: 0,
          previousUploadId: firstUsage.id,
        },
        {
          version: 1,
          uploadId: firstUsage.id,
          filename: 'usage-v1.csv',
          isLatest: false,
          changedFromPrevious: null,
          byteDeltaFromPrevious: null,
          previousUploadId: undefined,
        },
      ],
    })
  })

  it('persists upload metadata to a JSON store and reloads it by workspace', async () => {
    const store = new JsonUploadStore(join(tempDir, 'uploads.json'))
    const record = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'stripe_customers_export',
      filename: 'customers.csv',
      byteSize: 512,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_001/customers.csv',
      uploadedBy: 'user_finance',
    })

    await store.save(record)

    const reloadedStore = new JsonUploadStore(join(tempDir, 'uploads.json'))
    await expect(reloadedStore.listByWorkspace('workspace_001')).resolves.toEqual([record])
    await expect(reloadedStore.listByWorkspace('other_workspace')).resolves.toEqual([])
  })

  it('preserves corrected uploads that reuse the same filename', async () => {
    const storage = new LocalUploadStorage(join(tempDir, 'files'))
    const firstSaved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage-may.csv',
      bytes: Buffer.from('account_id,total\nacct_1,42\n'),
    })
    const secondSaved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage-may.csv',
      bytes: Buffer.from('account_id,total\nacct_1,84\n'),
    })
    const firstRecord = createUploadRecord(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        filename: 'usage-may.csv',
        uploadedBy: 'user_finance',
        ...firstSaved,
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )
    const secondRecord = createUploadRecord(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        filename: 'usage-may.csv',
        uploadedBy: 'user_finance',
        ...secondSaved,
      },
      new Date('2026-06-01T10:05:00.000Z'),
    )
    const store = new JsonUploadStore(join(tempDir, 'uploads.json'))

    await store.save(firstRecord)
    await store.save(secondRecord)

    expect(firstSaved.storageKey).not.toBe(secondSaved.storageKey)
    expect(firstRecord.id).not.toBe(secondRecord.id)
    await expect(storage.readText(firstSaved.storageKey)).resolves.toBe('account_id,total\nacct_1,42\n')
    await expect(storage.readText(secondSaved.storageKey)).resolves.toBe('account_id,total\nacct_1,84\n')
    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([firstRecord, secondRecord])
  })

  it('records review metadata when an internal operator marks an upload accepted or rejected', () => {
    const record = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      byteSize: 1024,
      contentType: 'application/pdf',
      storageKey: 'workspaces/workspace_001/pricing.pdf',
      uploadedBy: 'user_revops',
    })

    const reviewed = reviewUploadRecord(
      record,
      {
        status: 'needs_clarification',
        reviewedBy: 'internal_admin',
        reviewNote: 'Missing prepaid credit schedule.',
      },
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(reviewed).toMatchObject({
      status: 'needs_clarification',
      reviewedBy: 'internal_admin',
      reviewedAt: '2026-06-01T12:00:00.000Z',
      reviewNote: 'Missing prepaid credit schedule.',
    })
  })

  it('stores category-level task comments for missing or incorrect upload requirements', async () => {
    const store = new JsonUploadTaskCommentStore(join(tempDir, 'upload-comments.json'))
    const firstComment = createUploadTaskComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        body: 'Can you re-upload usage with period_end populated?',
        authorId: 'internal_admin',
        authorName: 'Rory',
        authorRole: 'internal_admin',
      },
      new Date('2026-06-01T12:00:00.000Z'),
    )
    const secondComment = createUploadTaskComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        body: 'Updated export will be ready before close today.',
        authorId: 'user_finance',
        authorName: 'Finance Lead',
        authorRole: 'customer_admin',
      },
      new Date('2026-06-01T12:30:00.000Z'),
    )
    const otherWorkspaceComment = createUploadTaskComment({
      organizationId: 'org_002',
      workspaceId: 'workspace_002',
      category: 'usage_csv',
      body: 'Different workspace thread.',
      authorId: 'internal_admin',
      authorName: 'Rory',
      authorRole: 'internal_admin',
    })

    await store.save(firstComment)
    await store.save(otherWorkspaceComment)
    await store.save(secondComment)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([firstComment, secondComment])
    await expect(store.listByCategory('workspace_001', 'usage_csv')).resolves.toEqual([firstComment, secondComment])
    await expect(store.listByCategory('workspace_002', 'usage_csv')).resolves.toEqual([otherWorkspaceComment])
  })

  it('builds a safe storage key without preserving path traversal from filenames', () => {
    const key = buildStorageKey({
      workspaceId: 'workspace_001',
      category: 'contracts_order_forms',
      filename: '../contracts/../../Acme Order Form.pdf',
    })

    expect(key).toBe('workspaces/workspace_001/contracts_order_forms/acme_order_form.pdf')
    expect(key).not.toContain('..')
  })

  it('writes uploaded file bytes under the configured local storage root', async () => {
    const storage = new LocalUploadStorage(join(tempDir, 'files'))
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'Usage May.csv',
      bytes: Buffer.from('account_id,total\nacct_1,42\n'),
    })

    await expect(readFile(join(tempDir, 'files', saved.storageKey), 'utf8')).resolves.toBe('account_id,total\nacct_1,42\n')
    expect(saved).toMatchObject({
      byteSize: 27,
      contentType: 'text/csv',
    })
    expect(saved.storageKey).toMatch(/^workspaces\/workspace_001\/usage_csv\/usage_may_[a-f0-9]{12}\.csv$/)
    expect(saved.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reads uploaded file bytes back for internal download', async () => {
    const storage = new LocalUploadStorage(join(tempDir, 'files'))
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      bytes: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    })

    await expect(storage.readBytes(saved.storageKey)).resolves.toEqual(Buffer.from('%PDF-1.7'))
  })

  it('creates and verifies expiring upload download tokens', () => {
    const secret = 'download-secret'
    const token = createUploadDownloadToken(
      {
        uploadId: 'upl_001',
        workspaceId: 'workspace_001',
        expiresInSeconds: 300,
      },
      secret,
      new Date('2026-06-01T10:00:00.000Z'),
    )

    const payload = verifyUploadDownloadToken(token, secret, new Date('2026-06-01T10:04:59.000Z'))

    expect(payload).toEqual({
      uploadId: 'upl_001',
      workspaceId: 'workspace_001',
      expiresAt: '2026-06-01T10:05:00.000Z',
    })
    expect(() => verifyUploadDownloadToken(token, secret, new Date('2026-06-01T10:05:01.000Z'))).toThrow('Download token has expired')
  })

  it('rejects tampered upload download tokens', () => {
    const secret = 'download-secret'
    const token = createUploadDownloadToken(
      {
        uploadId: 'upl_001',
        workspaceId: 'workspace_001',
        expiresInSeconds: 300,
      },
      secret,
      new Date('2026-06-01T10:00:00.000Z'),
    )
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`

    expect(() => verifyUploadDownloadToken(tampered, secret, new Date('2026-06-01T10:01:00.000Z'))).toThrow(
      'Invalid download token signature',
    )
  })
})
