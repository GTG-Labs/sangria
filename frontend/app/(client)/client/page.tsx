import { redirect } from "next/navigation";

export default function ClientIndexPage() {
  redirect("/client/dashboard");
}
