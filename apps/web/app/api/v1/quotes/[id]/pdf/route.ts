import { renderQuotePdf } from "@repo/core/quotes/pdf";
import { getQuote } from "@repo/core/quotes/service";
import { ApiResponse, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "crm:read", rateLimit: 30 }, async ({ ctx, params, req }) => {
  const quote = await getQuote(ctx, params.id);
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new ApiResponse(await renderQuotePdf(quote), 200, {
    "content-type": "application/pdf",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${quote.number}.pdf"`,
  });
});
