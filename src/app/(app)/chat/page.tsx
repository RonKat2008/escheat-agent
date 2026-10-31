import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChatApp } from "@/components/chat/ChatApp";
import { chatAvailability, chatModel } from "@/lib/chat/agent";

export const metadata: Metadata = { title: "Chat" };

/** Reads env at request time (keys can change between deploys), so it renders dynamically. */
async function ChatWithAvailability() {
  await connection();
  return <ChatApp availability={chatAvailability()} model={chatModel()} />;
}

function ChatFallback() {
  return <div className="min-h-[60dvh]" aria-busy="true" aria-label="Loading chat" />;
}

export default function Page() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatWithAvailability />
    </Suspense>
  );
}
