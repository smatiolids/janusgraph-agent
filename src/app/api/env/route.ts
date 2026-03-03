import { NextResponse } from "next/server";

const requiredEnvVars = ["OPENAI_API_KEY"] as const;

export async function GET() {
  const missing = requiredEnvVars.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });

  return NextResponse.json({
    ok: missing.length === 0,
    missing
  });
}
