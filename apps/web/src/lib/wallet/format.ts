/** 254712345678 -> "0712 •••678" for at-a-glance confirmation without exposing the full number. */
export function maskMsisdn(msisdn: string): string {
  const local = msisdn.startsWith('254') ? `0${msisdn.slice(3)}` : msisdn;
  return local.length >= 10 ? `${local.slice(0, 4)} •••${local.slice(-3)}` : local;
}
