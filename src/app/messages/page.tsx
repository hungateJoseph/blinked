import MessagesList from "@/components/MessagesList";
import { requireUser } from "@/lib/auth";
import { listEnquiries } from "@/lib/enquiries";

/** Enquiries couples have left on the public availability page. */
export default async function MessagesPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Enquiries</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          What couples send from your{" "}
          <a href={`/p/${user.public_slug}`} className="font-medium text-rose-700 underline">
            availability page
          </a>
          , no account needed. Your assistant reads these when you ask about an enquiry.
        </p>
      </div>

      <MessagesList initialEnquiries={listEnquiries(user.id, true)} />
    </div>
  );
}
