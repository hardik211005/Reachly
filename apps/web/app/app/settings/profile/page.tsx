import type { Metadata } from "next";
import { ProfileSettings } from "@/components/settings/profile-settings";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage() {
  return <ProfileSettings />;
}
