import type { PickedFile } from '@/platform';

export const SAMPLE_NAME = 'rental-application-sample.pdf';

/** Builds the sample form on demand (pdf-lib is already part of the export path). */
export async function loadSampleForm(): Promise<PickedFile> {
  const { buildRentalApplication } = await import('@/samples/rentalApplication');
  return { name: SAMPLE_NAME, path: null, bytes: await buildRentalApplication() };
}
