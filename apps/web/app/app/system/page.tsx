import { redirect } from "next/navigation";

/** Server health moved to the admin portal; businesses never see server internals. */
export default function SystemPage() {
  redirect("/admin/system");
}
