import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { contractBillingPeriodSchema, contractTermSchema, type ContractTerm } from './schemas'
import { type UploadRecord, type UploadStorage } from './uploads'

export type ExtractContractTermsInput = {
  organizationId: string
  workspaceId: string
  customerId?: string
  sourceFileId: string
  text: string
}

export type ExtractStructuredContractTermsInput = Omit<ExtractContractTermsInput, 'text'> & {
  output: string
}

const structuredExtractionCurrencySchema = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((value) => value.toLowerCase())

const structuredExtractionEvidenceSchema = z
  .object({
    page: z.number().int().positive().optional(),
    snippet: z.string().min(1).optional(),
  })
  .strict()

const structuredExtractionEvidenceQualitySchema = z
  .object({
    level: z.enum(['strong', 'medium', 'weak']),
    signals: z.array(z.string().min(1)),
    missingSignals: z.array(z.string().min(1)),
  })
  .strict()

const structuredExtractionCommonFields = {
  customerId: z.string().min(1).optional(),
  meter: z.string().min(1).optional(),
  billingPeriod: contractBillingPeriodSchema.optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: structuredExtractionEvidenceSchema.optional(),
  evidenceQuality: structuredExtractionEvidenceQualitySchema.optional(),
}

export const structuredContractExtractionTermSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('allowance'),
      allowance: z.number().nonnegative(),
      unit: z.string().min(1),
      threshold: z.number().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('overage_rate'),
      rate: z.number().nonnegative(),
      currency: structuredExtractionCurrencySchema,
      unit: z.string().min(1),
      threshold: z.number().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('rate'),
      rate: z.number().nonnegative(),
      currency: structuredExtractionCurrencySchema,
      unit: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('credit'),
      creditAmount: z.number().nonnegative(),
      currency: structuredExtractionCurrencySchema,
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('minimum'),
      minimumAmount: z.number().nonnegative(),
      currency: structuredExtractionCurrencySchema,
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('discount'),
      discountPercent: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      ...structuredExtractionCommonFields,
      type: z.literal('special_term'),
      summary: z.string().min(1),
    })
    .strict(),
])

export const contractExtractionOutputSchema = z
  .object({
    schemaVersion: z.literal('contract_extraction.v1'),
    terms: z.array(structuredContractExtractionTermSchema),
  })
  .strict()

type StructuredContractExtractionOutput = z.infer<typeof contractExtractionOutputSchema>
type StructuredContractExtractionTerm = z.infer<typeof structuredContractExtractionTermSchema>

export type ReviewContractTermInput = {
  status: 'approved' | 'rejected' | 'candidate'
  reviewerId: string
  note?: string
  updates?: Partial<
    Pick<
      ContractTerm,
      | 'type'
      | 'meter'
      | 'unit'
      | 'billingPeriod'
      | 'rate'
      | 'allowance'
      | 'threshold'
      | 'creditAmount'
      | 'minimumAmount'
      | 'discountPercent'
      | 'currency'
      | 'effectiveFrom'
      | 'effectiveTo'
    >
  >
}

export const contractTermVersionSchema = z.object({
  id: z.string().min(1),
  termId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  reviewerId: z.string().min(1),
  note: z.string().optional(),
  changedFields: z.array(z.string().min(1)),
  before: contractTermSchema,
  after: contractTermSchema,
  reviewedAt: z.string().datetime(),
})

export type ContractTermVersion = z.infer<typeof contractTermVersionSchema>

export const contractTermFeedbackSchema = z.object({
  id: z.string().min(1),
  termId: z.string().min(1),
  versionId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  reviewerId: z.string().min(1),
  outcome: z.enum(['candidate', 'approved', 'rejected']),
  note: z.string().optional(),
  correctionCount: z.number().int().nonnegative(),
  corrections: z.array(
    z.object({
      field: z.string().min(1),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
    }),
  ),
  extractionContext: z.object({
    type: contractTermSchema.shape.type,
    sourceFileId: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceQualityLevel: z.enum(['strong', 'medium', 'weak']).optional(),
  }),
  reviewedAt: z.string().datetime(),
})

export type ContractTermFeedback = z.infer<typeof contractTermFeedbackSchema>

const contractTermStoreSchema = z.object({
  terms: z.array(contractTermSchema).default([]),
  versions: z.array(contractTermVersionSchema).default([]),
  feedback: z.array(contractTermFeedbackSchema).default([]),
})

type ContractTermStoreData = z.infer<typeof contractTermStoreSchema>

export function extractCandidateContractTermsFromText(input: ExtractContractTermsInput): ContractTerm[] {
  const lines = parseContractLines(input.text)
  const effectiveDates = findEffectiveDates(lines)
  const terms: ContractTerm[] = []

  for (const line of lines) {
    const base = {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      customerId: input.customerId,
      evidence: {
        sourceFileId: input.sourceFileId,
        page: line.page,
        snippet: line.text,
      },
      effectiveFrom: effectiveDates.effectiveFrom,
      effectiveTo: effectiveDates.effectiveTo,
      status: 'candidate' as const,
    }

    const allowance = parseAllowance(line.text)
    if (allowance) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'allowance', terms.length + 1),
            type: 'allowance',
            allowance: allowance.quantity,
            unit: allowance.unit,
          }),
          'allowance',
        ),
      )
      continue
    }

    const overageRate = parseOverageRate(line.text)
    if (overageRate) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'overage_rate', terms.length + 1),
            type: 'overage_rate',
            rate: overageRate.rate,
            currency: overageRate.currency,
            unit: overageRate.unit,
          }),
          'overage rate',
        ),
      )
      continue
    }

    const credit = parseMoneyTerm(line.text, /prepaid credit:\s*([A-Z]{3})\s*([\d,.]+)/i)
    if (credit) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'credit', terms.length + 1),
            type: 'credit',
            creditAmount: credit.amount,
            currency: credit.currency,
          }),
          'credit',
        ),
      )
      continue
    }

    const minimum = parseMoneyTerm(line.text, /minimum commitment:\s*([A-Z]{3})\s*([\d,.]+)/i)
    if (minimum) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'minimum', terms.length + 1),
            type: 'minimum',
            minimumAmount: minimum.amount,
            currency: minimum.currency,
          }),
          'minimum',
        ),
      )
      continue
    }

    const discount = parseDiscount(line.text)
    if (discount) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'discount', terms.length + 1),
            type: 'discount',
            discountPercent: discount.percent,
            effectiveTo: discount.effectiveTo ?? effectiveDates.effectiveTo,
          }),
          'discount',
        ),
      )
      continue
    }

    const specialTerm = parseSpecialTerm(line.text)
    if (specialTerm) {
      terms.push(
        withExtractionConfidence(
          contractTermSchema.parse({
            ...base,
            id: createTermId(input.workspaceId, input.sourceFileId, 'special_term', terms.length + 1),
            type: 'special_term',
            metadata: {
              summary: specialTerm,
            },
          }),
          'special term',
        ),
      )
    }
  }

  return terms
}

export function extractCandidateContractTermsFromStructuredOutput(input: ExtractStructuredContractTermsInput): ContractTerm[] {
  const output = parseStructuredContractExtractionOutput(input.output)

  return output.terms.map((term, index) =>
    contractTermSchema.parse({
      id: createTermId(input.workspaceId, input.sourceFileId, term.type, index + 1),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      customerId: term.customerId ?? input.customerId,
      type: term.type,
      ...structuredTermFields(term),
      effectiveFrom: term.effectiveFrom,
      effectiveTo: term.effectiveTo,
      confidence: term.confidence,
      status: 'candidate',
      evidence: {
        sourceFileId: input.sourceFileId,
        page: term.evidence?.page,
        snippet: term.evidence?.snippet,
      },
      metadata: structuredTermMetadata(output, term),
    }),
  )
}

export async function extractCandidateContractTermsFromUpload(upload: UploadRecord, storage: UploadStorage): Promise<ContractTerm[]> {
  const text = await storage.readText(upload.storageKey)

  return extractCandidateContractTermsFromText({
    organizationId: upload.organizationId,
    workspaceId: upload.workspaceId,
    sourceFileId: upload.sourceFileId,
    text,
  })
}

function parseStructuredContractExtractionOutput(output: string): StructuredContractExtractionOutput {
  let parsed: unknown

  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('Structured contract extraction output must be valid JSON')
  }

  return contractExtractionOutputSchema.parse(parsed)
}

function structuredTermFields(term: StructuredContractExtractionTerm): Partial<ContractTerm> {
  const commonFields = {
    meter: term.meter,
    billingPeriod: term.billingPeriod,
  }

  if (term.type === 'allowance') {
    return {
      ...commonFields,
      allowance: term.allowance,
      threshold: term.threshold,
      unit: term.unit,
    }
  }

  if (term.type === 'overage_rate') {
    return {
      ...commonFields,
      rate: term.rate,
      currency: term.currency,
      threshold: term.threshold,
      unit: term.unit,
    }
  }

  if (term.type === 'rate') {
    return {
      ...commonFields,
      rate: term.rate,
      currency: term.currency,
      unit: term.unit,
    }
  }

  if (term.type === 'credit') {
    return {
      ...commonFields,
      creditAmount: term.creditAmount,
      currency: term.currency,
    }
  }

  if (term.type === 'minimum') {
    return {
      ...commonFields,
      minimumAmount: term.minimumAmount,
      currency: term.currency,
    }
  }

  if (term.type === 'discount') {
    return {
      ...commonFields,
      discountPercent: term.discountPercent,
    }
  }

  return commonFields
}

function structuredTermMetadata(output: StructuredContractExtractionOutput, term: StructuredContractExtractionTerm): Record<string, unknown> {
  return {
    extractionSchemaVersion: output.schemaVersion,
    ...(term.evidenceQuality ? { evidenceQuality: term.evidenceQuality } : {}),
    ...(term.type === 'special_term' ? { summary: term.summary } : {}),
  }
}

export function reviewContractTerm(term: ContractTerm, review: ReviewContractTermInput, now = new Date()): ContractTerm {
  return contractTermSchema.parse({
    ...term,
    ...review.updates,
    status: review.status,
    metadata: {
      ...term.metadata,
      reviewerId: review.reviewerId,
      reviewedAt: now.toISOString(),
      reviewNote: review.note,
    },
  })
}

export function createContractTermVersion(
  before: ContractTerm,
  after: ContractTerm,
  input: {
    reviewerId: string
    note?: string
    reviewedAt?: Date
  },
): ContractTermVersion {
  const reviewedAt = input.reviewedAt ?? new Date()

  return contractTermVersionSchema.parse({
    id: `term_version_${after.id}_${slugTimestamp(reviewedAt.toISOString())}`,
    termId: after.id,
    organizationId: after.organizationId,
    workspaceId: after.workspaceId,
    reviewerId: input.reviewerId,
    note: input.note,
    changedFields: changedContractTermFields(before, after),
    before,
    after,
    reviewedAt: reviewedAt.toISOString(),
  })
}

export function createContractTermFeedback(version: ContractTermVersion): ContractTermFeedback {
  return contractTermFeedbackSchema.parse({
    id: `term_feedback_${version.id}`,
    termId: version.termId,
    versionId: version.id,
    organizationId: version.organizationId,
    workspaceId: version.workspaceId,
    reviewerId: version.reviewerId,
    outcome: version.after.status,
    note: version.note,
    correctionCount: version.changedFields.length,
    corrections: version.changedFields.map((field) => fieldCorrection(version.before, version.after, field)),
    extractionContext: {
      type: version.before.type,
      sourceFileId: version.before.evidence?.sourceFileId,
      page: version.before.evidence?.page,
      confidence: version.before.confidence,
      evidenceQualityLevel: evidenceQualityLevelFromMetadata(version.before.metadata.evidenceQuality),
    },
    reviewedAt: version.reviewedAt,
  })
}

export class JsonContractTermStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ContractTerm[]> {
    return (await this.read()).terms
  }

  async listByWorkspace(workspaceId: string): Promise<ContractTerm[]> {
    const terms = await this.list()

    return terms.filter((term) => term.workspaceId === workspaceId)
  }

  async saveMany(terms: ContractTerm[]): Promise<void> {
    const data = await this.read()
    const nextById = new Map(data.terms.map((term) => [term.id, term]))

    for (const term of terms) {
      nextById.set(term.id, term)
    }

    await this.write({
      ...data,
      terms: [...nextById.values()],
    })
  }

  async appendVersion(version: ContractTermVersion): Promise<void> {
    const data = await this.read()
    const versions = [...data.versions.filter((existing) => existing.id !== version.id), version]

    await this.write({
      ...data,
      versions,
    })
  }

  async appendFeedback(feedback: ContractTermFeedback): Promise<void> {
    const data = await this.read()
    const nextFeedback = [...data.feedback.filter((existing) => existing.id !== feedback.id), feedback]

    await this.write({
      ...data,
      feedback: nextFeedback,
    })
  }

  async listVersions(termId: string): Promise<ContractTermVersion[]> {
    const data = await this.read()

    return data.versions
      .filter((version) => version.termId === termId)
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
  }

  async listFeedbackForTerm(termId: string): Promise<ContractTermFeedback[]> {
    const data = await this.read()

    return data.feedback
      .filter((feedback) => feedback.termId === termId)
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
  }

  async listFeedbackByWorkspace(workspaceId: string): Promise<ContractTermFeedback[]> {
    const data = await this.read()

    return data.feedback
      .filter((feedback) => feedback.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const data = await this.read()
    const terms = data.terms.filter((term) => term.workspaceId !== workspaceId)
    const versions = data.versions.filter((version) => version.workspaceId !== workspaceId)
    const feedback = data.feedback.filter((item) => item.workspaceId !== workspaceId)

    await this.write({
      terms,
      versions,
      feedback,
    })

    return data.terms.length - terms.length
  }

  private async read(): Promise<ContractTermStoreData> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return contractTermStoreSchema.parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return { terms: [], versions: [], feedback: [] }
      }

      throw error
    }
  }

  private async write(data: ContractTermStoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

function fieldCorrection(before: ContractTerm, after: ContractTerm, field: string) {
  const beforeValue = before[field as keyof ContractTerm]
  const afterValue = after[field as keyof ContractTerm]

  return {
    field,
    ...(beforeValue !== undefined ? { before: beforeValue } : {}),
    ...(afterValue !== undefined ? { after: afterValue } : {}),
  }
}

function evidenceQualityLevelFromMetadata(value: unknown): ContractTermFeedback['extractionContext']['evidenceQualityLevel'] {
  if (!isRecord(value)) {
    return undefined
  }

  const level = value.level

  return level === 'strong' || level === 'medium' || level === 'weak' ? level : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type ExtractionEvidenceQuality = {
  level: 'strong' | 'medium' | 'weak'
  signals: string[]
  missingSignals: string[]
}

function withExtractionConfidence(term: ContractTerm, termLabel: string): ContractTerm {
  const { confidence, evidenceQuality } = scoreExtractionEvidence(term, termLabel)

  return contractTermSchema.parse({
    ...term,
    confidence,
    metadata: {
      ...term.metadata,
      evidenceQuality,
    },
  })
}

function scoreExtractionEvidence(
  term: ContractTerm,
  termLabel: string,
): {
  confidence: number
  evidenceQuality: ExtractionEvidenceQuality
} {
  const signals = [`recognized ${termLabel} pattern`]
  const missingSignals: string[] = []
  let confidence = 0.6

  if (term.evidence?.sourceFileId) {
    signals.push('source file captured')
  } else {
    missingSignals.push('source file missing')
  }

  if (term.evidence?.page) {
    signals.push('source page captured')
    confidence += 0.05
  } else {
    missingSignals.push('source page missing')
  }

  if (term.evidence?.snippet) {
    signals.push('evidence snippet captured')
    confidence += 0.1
  } else {
    missingSignals.push('evidence snippet missing')
  }

  if (term.effectiveFrom && term.effectiveTo) {
    signals.push('effective date window captured')
    confidence += 0.05
  } else {
    missingSignals.push('effective date window missing')
  }

  if (term.customerId) {
    signals.push('customer id captured')
    confidence += 0.05
  } else {
    missingSignals.push('customer id missing')
  }

  if (hasRequiredExtractionFields(term)) {
    signals.push(`required ${termLabel} fields captured`)
    confidence += 0.05
  } else {
    missingSignals.push(`required ${termLabel} fields missing`)
  }

  const roundedConfidence = roundConfidence(confidence)

  return {
    confidence: roundedConfidence,
    evidenceQuality: {
      level: evidenceQualityLevel(roundedConfidence),
      signals,
      missingSignals,
    },
  }
}

function hasRequiredExtractionFields(term: ContractTerm): boolean {
  if (term.type === 'allowance') {
    return term.allowance !== undefined && Boolean(term.unit)
  }

  if (term.type === 'overage_rate' || term.type === 'rate') {
    return term.rate !== undefined && Boolean(term.currency) && Boolean(term.unit)
  }

  if (term.type === 'credit') {
    return term.creditAmount !== undefined && Boolean(term.currency)
  }

  if (term.type === 'minimum') {
    return term.minimumAmount !== undefined && Boolean(term.currency)
  }

  if (term.type === 'discount') {
    return term.discountPercent !== undefined
  }

  return typeof term.metadata.summary === 'string' && term.metadata.summary.trim().length > 0
}

function evidenceQualityLevel(confidence: number): ExtractionEvidenceQuality['level'] {
  if (confidence >= 0.85) {
    return 'strong'
  }

  if (confidence >= 0.65) {
    return 'medium'
  }

  return 'weak'
}

function roundConfidence(value: number): number {
  return Math.min(1, Math.round(value * 100) / 100)
}

function parseContractLines(text: string): Array<{ page?: number; text: string }> {
  return text
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter(Boolean)
    .map((rawLine) => {
      const pageMatch = /^Page\s+(\d+):\s*(.+)$/i.exec(rawLine)

      if (!pageMatch) {
        return { text: rawLine }
      }

      return {
        page: Number.parseInt(pageMatch[1], 10),
        text: pageMatch[2].trim(),
      }
    })
}

function findEffectiveDates(lines: Array<{ text: string }>): { effectiveFrom?: string; effectiveTo?: string } {
  for (const line of lines) {
    const match = /effective from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i.exec(line.text)

    if (match) {
      return {
        effectiveFrom: match[1],
        effectiveTo: match[2],
      }
    }
  }

  return {}
}

function parseAllowance(text: string): { quantity: number; unit: string } | null {
  const match = /included allowance:\s*([\d,]+)\s+(.+?)(?:\s+per month)?\.?$/i.exec(text)

  if (!match) {
    return null
  }

  return {
    quantity: Number.parseInt(match[1].replaceAll(',', ''), 10),
    unit: normalizeUnit(match[2]),
  }
}

function parseOverageRate(text: string): { currency: string; rate: number; unit: string } | null {
  const match = /overage charged at\s+([A-Z]{3})\s*([\d,.]+)\s+per\s+(.+?)\.?$/i.exec(text)

  if (!match) {
    return null
  }

  return {
    currency: match[1].toLowerCase(),
    rate: parseDecimal(match[2]),
    unit: normalizeUnit(match[3]),
  }
}

function parseMoneyTerm(text: string, pattern: RegExp): { currency: string; amount: number } | null {
  const match = pattern.exec(text)

  if (!match) {
    return null
  }

  return {
    currency: match[1].toLowerCase(),
    amount: parseDecimal(match[2]),
  }
}

function parseDiscount(text: string): { percent: number; effectiveTo?: string } | null {
  const match = /discount:\s*([\d.]+)%(?:.*?(?:until|through)\s+(\d{4}-\d{2}-\d{2}))?/i.exec(text)

  if (!match) {
    return null
  }

  return {
    percent: parseDecimal(match[1]),
    effectiveTo: match[2],
  }
}

function parseSpecialTerm(text: string): string | null {
  const match = /special term:\s*(.+)$/i.exec(text)

  return match?.[1]?.trim() ?? null
}

function changedContractTermFields(before: ContractTerm, after: ContractTerm): string[] {
  return [
    'type',
    'meter',
    'unit',
    'billingPeriod',
    'rate',
    'allowance',
    'threshold',
    'creditAmount',
    'minimumAmount',
    'discountPercent',
    'currency',
    'effectiveFrom',
    'effectiveTo',
    'status',
  ].filter((field) => before[field as keyof ContractTerm] !== after[field as keyof ContractTerm])
}

function createTermId(workspaceId: string, sourceFileId: string, type: ContractTerm['type'], index: number): string {
  return `term_${slug(workspaceId)}_${slug(sourceFileId)}_${type}_${index}`
}

function normalizeUnit(value: string): string {
  return value
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseDecimal(value: string): number {
  return Number.parseFloat(value.replaceAll(',', ''))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
