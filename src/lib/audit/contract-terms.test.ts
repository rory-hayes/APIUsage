import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  JsonContractTermStore,
  contractExtractionOutputSchema,
  createContractTermFeedback,
  createContractTermVersion,
  extractCandidateContractTermsFromUpload,
  extractCandidateContractTermsFromStructuredOutput,
  extractCandidateContractTermsFromText,
  reviewContractTerm,
} from './contract-terms'
import { createUploadRecord, LocalUploadStorage } from './uploads'

describe('contract term extraction and review', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-contract-terms-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('extracts candidate commercial terms with evidence snippets from contract text', () => {
    const terms = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_acme',
      sourceFileId: 'src_contract_001',
      text: [
        'Page 1: Effective from 2026-05-01 to 2027-04-30.',
        'Page 3: Included allowance: 10,000 API calls per month.',
        'Page 3: Overage charged at EUR 2.50 per 1k API calls.',
        'Page 4: Annual prepaid credit: EUR 50,000.',
        'Page 4: Monthly minimum commitment: EUR 20,000.',
        'Page 5: Discount: 15% until 2026-12-31.',
        'Page 6: Special term: customer may rollover unused credits for 60 days.',
      ].join('\n'),
    })

    expect(terms).toMatchObject([
      {
        id: 'term_workspace_001_src_contract_001_allowance_1',
        type: 'allowance',
        customerId: 'cus_acme',
        allowance: 10000,
        unit: 'api_calls',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
        status: 'candidate',
        evidence: {
          sourceFileId: 'src_contract_001',
          page: 3,
          snippet: 'Included allowance: 10,000 API calls per month.',
        },
      },
      {
        id: 'term_workspace_001_src_contract_001_overage_rate_2',
        type: 'overage_rate',
        rate: 2.5,
        currency: 'eur',
        unit: '1k_api_calls',
        evidence: {
          page: 3,
          snippet: 'Overage charged at EUR 2.50 per 1k API calls.',
        },
      },
      {
        id: 'term_workspace_001_src_contract_001_credit_3',
        type: 'credit',
        creditAmount: 50000,
        currency: 'eur',
      },
      {
        id: 'term_workspace_001_src_contract_001_minimum_4',
        type: 'minimum',
        minimumAmount: 20000,
        currency: 'eur',
      },
      {
        id: 'term_workspace_001_src_contract_001_discount_5',
        type: 'discount',
        discountPercent: 15,
        effectiveTo: '2026-12-31',
      },
      {
        id: 'term_workspace_001_src_contract_001_special_term_6',
        type: 'special_term',
        metadata: {
          summary: 'customer may rollover unused credits for 60 days.',
        },
      },
    ])
  })

  it('scores extracted terms with confidence and evidence quality indicators', () => {
    const terms = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_acme',
      sourceFileId: 'src_contract_001',
      text: [
        'Page 1: Effective from 2026-05-01 to 2027-04-30.',
        'Page 3: Included allowance: 10,000 API calls per month.',
      ].join('\n'),
    })

    expect(terms[0]).toMatchObject({
      type: 'allowance',
      confidence: 0.9,
      metadata: {
        evidenceQuality: {
          level: 'strong',
          signals: [
            'recognized allowance pattern',
            'source file captured',
            'source page captured',
            'evidence snippet captured',
            'effective date window captured',
            'customer id captured',
            'required allowance fields captured',
          ],
          missingSignals: [],
        },
      },
    })
  })

  it('lowers confidence when evidence quality indicators are missing', () => {
    const terms = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'src_contract_001',
      text: 'Included allowance: 10,000 API calls per month.',
    })

    expect(terms[0]).toMatchObject({
      type: 'allowance',
      confidence: 0.75,
      metadata: {
        evidenceQuality: {
          level: 'medium',
          signals: ['recognized allowance pattern', 'source file captured', 'evidence snippet captured', 'required allowance fields captured'],
          missingSignals: ['source page missing', 'effective date window missing', 'customer id missing'],
        },
      },
    })
  })

  it('validates strict structured JSON extraction output into candidate terms', () => {
    const terms = extractCandidateContractTermsFromStructuredOutput({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_acme',
      sourceFileId: 'src_llm_contract_001',
      output: JSON.stringify({
        schemaVersion: 'contract_extraction.v1',
        terms: [
          {
            type: 'allowance',
            allowance: 10000,
            unit: 'api_calls',
            effectiveFrom: '2026-05-01',
            effectiveTo: '2027-04-30',
            confidence: 0.92,
            evidence: {
              page: 3,
              snippet: 'Included allowance: 10,000 API calls per month.',
            },
            evidenceQuality: {
              level: 'strong',
              signals: ['source page captured', 'evidence snippet captured'],
              missingSignals: [],
            },
          },
          {
            type: 'special_term',
            summary: 'customer may rollover unused credits for 60 days.',
            effectiveFrom: '2026-05-01',
            effectiveTo: '2027-04-30',
            confidence: 0.88,
            evidence: {
              page: 6,
              snippet: 'Special term: customer may rollover unused credits for 60 days.',
            },
          },
        ],
      }),
    })

    expect(terms).toMatchObject([
      {
        id: 'term_workspace_001_src_llm_contract_001_allowance_1',
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        customerId: 'cus_acme',
        type: 'allowance',
        allowance: 10000,
        unit: 'api_calls',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
        confidence: 0.92,
        status: 'candidate',
        evidence: {
          sourceFileId: 'src_llm_contract_001',
          page: 3,
          snippet: 'Included allowance: 10,000 API calls per month.',
        },
        metadata: {
          extractionSchemaVersion: 'contract_extraction.v1',
          evidenceQuality: {
            level: 'strong',
            signals: ['source page captured', 'evidence snippet captured'],
            missingSignals: [],
          },
        },
      },
      {
        id: 'term_workspace_001_src_llm_contract_001_special_term_2',
        type: 'special_term',
        confidence: 0.88,
        metadata: {
          extractionSchemaVersion: 'contract_extraction.v1',
          summary: 'customer may rollover unused credits for 60 days.',
        },
      },
    ])
  })

  it('rejects malformed or non-strict structured extraction output before creating terms', () => {
    expect(() =>
      extractCandidateContractTermsFromStructuredOutput({
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        sourceFileId: 'src_llm_contract_001',
        output: '{not-json',
      }),
    ).toThrow('Structured contract extraction output must be valid JSON')

    expect(
      contractExtractionOutputSchema.safeParse({
        schemaVersion: 'contract_extraction.v1',
        terms: [
          {
            type: 'allowance',
            allowance: 10000,
            unit: 'api_calls',
            unexpectedKey: 'should fail',
          },
        ],
      }).success,
    ).toBe(false)

    expect(
      contractExtractionOutputSchema.safeParse({
        schemaVersion: 'contract_extraction.v1',
        terms: [
          {
            type: 'overage_rate',
            currency: 'eur',
            unit: '1k_api_calls',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('persists terms, reviews edits, and records version history by term', async () => {
    const store = new JsonContractTermStore(join(tempDir, 'contract-terms.json'))
    const [candidate] = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'src_contract_001',
      text: 'Page 3: Overage charged at EUR 2.50 per 1k API calls.',
    })

    await store.saveMany([candidate])

    const reviewed = reviewContractTerm(
      candidate,
      {
        status: 'approved',
        reviewerId: 'internal_admin',
        note: 'Corrected to signed amendment.',
        updates: {
          rate: 2.75,
        },
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const version = createContractTermVersion(candidate, reviewed, {
      reviewerId: 'internal_admin',
      note: 'Corrected to signed amendment.',
      reviewedAt: new Date('2026-06-02T09:00:00.000Z'),
    })
    const feedback = createContractTermFeedback(version)

    await store.saveMany([reviewed])
    await store.appendVersion(version)
    await store.appendFeedback(feedback)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([reviewed])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([])
    await expect(store.listVersions(candidate.id)).resolves.toMatchObject([
      {
        termId: candidate.id,
        reviewerId: 'internal_admin',
        note: 'Corrected to signed amendment.',
        changedFields: ['rate', 'status'],
        before: {
          rate: 2.5,
          status: 'candidate',
        },
        after: {
          rate: 2.75,
          status: 'approved',
        },
        reviewedAt: '2026-06-02T09:00:00.000Z',
      },
    ])
    await expect(store.listFeedbackForTerm(candidate.id)).resolves.toMatchObject([
      {
        id: `term_feedback_${version.id}`,
        termId: candidate.id,
        versionId: version.id,
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        reviewerId: 'internal_admin',
        outcome: 'approved',
        note: 'Corrected to signed amendment.',
        correctionCount: 2,
        corrections: [
          {
            field: 'rate',
            before: 2.5,
            after: 2.75,
          },
          {
            field: 'status',
            before: 'candidate',
            after: 'approved',
          },
        ],
        extractionContext: {
          type: 'overage_rate',
          sourceFileId: 'src_contract_001',
          page: 3,
          confidence: 0.8,
          evidenceQualityLevel: 'medium',
        },
      },
    ])
  })

  it('extracts candidate terms from uploaded contract file bytes', async () => {
    const storage = new LocalUploadStorage(join(tempDir, 'files'))
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'contracts_order_forms',
      filename: 'acme-order-form.txt',
      bytes: Buffer.from('Page 3: Overage charged at EUR 2.50 per 1k API calls.'),
      contentType: 'text/plain',
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'contracts_order_forms',
      filename: 'acme-order-form.txt',
      uploadedBy: 'user_customer',
      ...saved,
    })

    const terms = await extractCandidateContractTermsFromUpload(upload, storage)

    expect(terms).toMatchObject([
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        type: 'overage_rate',
        rate: 2.5,
        currency: 'eur',
        evidence: {
          sourceFileId: upload.sourceFileId,
          page: 3,
          snippet: 'Overage charged at EUR 2.50 per 1k API calls.',
        },
      },
    ])
  })
})
