import type { Metadata } from "next";
import { Suspense } from "react";
import LoginPage from "@/components/LoginPage";

export const metadata: Metadata = {
  title: "Sign in · Project Tracker",
  description: "Sign in to the Project Tracker dashboard",
};

export default function Login() {
  // LoginPage reads ?reason= from the URL, which is only known per request: keep it out of the static shell.
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
