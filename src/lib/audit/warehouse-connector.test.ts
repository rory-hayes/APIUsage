import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonParsedRecordStore, JsonParseJobStore } from './parse-jobs'
import { JsonUploadStore, LocalUploadStorage } from './uploads'
import { createWarehouseCsvConnection, JsonWarehouseCsvConnectionStore, runAndPersistWarehouseCsvSync } from './warehouse-connector'

describe('warehouse csv connector', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-warehouse-connector-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists a read-only scheduled CSV export connection without storing the raw export URL', async () => {
    const store = new JsonWarehouseCsvConnectionStore(join(tempDir, 'warehouse-connections.json'))
    const connection = createWarehouseCsvConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        sourceLabel: 'Northstar warehouse usage',
        exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
        schedule: 'daily',
        connectedBy: 'user_engineering',
        usageCsvMapping: {
          accountId: 'tenant',
          customerName: 'company',
          meter: 'metric',
          quantity: 'units_used',
          unit: 'uom',
          periodStart: 'from_date',
          periodEnd: 'to_date',
        },
      },
      new Date('2026-06-03T12:00:00.000Z'),
    )

    await store.save(connection)

    await expect(store.getByWorkspace('workspace_northstar_june_2026')).resolves.toEqual({
      id: 'warehouse_csv_connection_workspace_northstar_june_2026_northstar_warehouse_usage',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      provider: 'warehouse_csv',
      mode: 'read_only',
      sourceLabel: 'Northstar warehouse usage',
      schedule: 'daily',
      secretRef: 'warehouse_csv_export_workspace_northstar_june_2026_1abb5526fee1',
      status: 'connected',
      connectedBy: 'user_engineering',
      usageCsvMapping: {
        accountId: 'tenant',
        customerName: 'company',
        meter: 'metric',
        quantity: 'units_used',
        unit: 'uom',
        periodStart: 'from_date',
        periodEnd: 'to_date',
      },
      createdAt: '2026-06-03T12:00:00.000Z',
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    await expect(store.list()).resolves.not.toContainEqual(
      expect.objectContaining({
        exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
      }),
    )
  })

  it('imports a warehouse CSV export into upload metadata, parse jobs, and normalized usage records', async () => {
    const connection = createWarehouseCsvConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        sourceLabel: 'Northstar warehouse usage',
        exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
        schedule: 'daily',
        connectedBy: 'user_engineering',
        usageCsvMapping: {
          accountId: 'tenant',
          customerName: 'company',
          meter: 'metric',
          quantity: 'units_used',
          unit: 'uom',
          periodStart: 'from_date',
          periodEnd: 'to_date',
        },
      },
      new Date('2026-06-03T12:00:00.000Z'),
    )
    const uploadStore = new JsonUploadStore(join(tempDir, 'uploads.json'))
    const parseJobStore = new JsonParseJobStore(join(tempDir, 'parse-jobs.json'))
    const parsedRecordStore = new JsonParsedRecordStore(join(tempDir, 'parsed-records.json'))
    const uploadStorage = new LocalUploadStorage(join(tempDir, 'files'))
    const fetchImpl = async (url: string) => {
      expect(url).toBe('https://warehouse.example.com/exports/usage.csv?token=sensitive')

      return {
        ok: true,
        status: 200,
        async text() {
          return [
            'tenant,company,metric,units_used,uom,from_date,to_date',
            'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
          ].join('\n')
        },
      }
    }

    const result = await runAndPersistWarehouseCsvSync({
      connection,
      exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
      requestedBy: 'internal_admin',
      fetchImpl,
      uploadStore,
      uploadStorage,
      parseJobStore,
      parsedRecordStore,
      now: new Date('2026-06-03T12:30:00.000Z'),
    })

    expect(result.upload).toMatchObject({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      category: 'usage_csv',
      filename: 'warehouse-usage-2026_06_03T12_30_00_000Z.csv',
      contentType: 'text/csv',
      uploadedBy: 'internal_admin',
      metadata: expect.objectContaining({
        source: 'warehouse_csv_export',
        connectionId: connection.id,
        sourceLabel: 'Northstar warehouse usage',
        schedule: 'daily',
        usageCsvMapping: connection.usageCsvMapping,
      }),
    })
    expect(result.job).toMatchObject({
      parser: 'usage_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: 'usage',
        data: expect.objectContaining({
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          meter: 'api_calls',
          quantity: 14_600_000,
          unit: 'calls',
        }),
      }),
    ])
    await expect(uploadStore.listByWorkspace(connection.workspaceId)).resolves.toEqual([result.upload])
    await expect(parseJobStore.listByWorkspace(connection.workspaceId)).resolves.toEqual([result.job])
    await expect(parsedRecordStore.listByWorkspace(connection.workspaceId)).resolves.toEqual(result.records)
  })
})
