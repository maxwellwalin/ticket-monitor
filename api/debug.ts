export async function GET() {
  const checks: string[] = [];

  // Test SeatGeek API directly
  const sgId = process.env.SEATGEEK_CLIENT_ID;
  checks.push(`sg_id_length: ${sgId?.length ?? 'undefined'}`);
  try {
    const url = `https://api.seatgeek.com/2/performers?q=Tame+Impala&per_page=1&client_id=${sgId}`;
    const res = await fetch(url);
    const text = await res.text();
    checks.push(`seatgeek: ${res.status} ${text.slice(0, 200)}`);
  } catch (e) {
    checks.push(`seatgeek: ${e}`);
  }

  return Response.json({ checks });
}
