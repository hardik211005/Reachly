import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function RootPage() {
  redirect((await getSession()) ? "/app" : "/login");
}
