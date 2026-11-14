import prisma from "../db.server";

export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      {
        ok: true,
        service: "subsmanager-manga",
        database: "connected",
        version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "local",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        service: "subsmanager-manga",
        database: "unavailable",
        version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "local",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};
