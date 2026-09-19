import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** The overview lives at the root; this address stays for shared links. */
export default async function DashboardRedirect({
  searchParams,
}: Readonly<{ searchParams?: Promise<SearchParams> }>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries((await searchParams) ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const query = params.toString();
  redirect(query === "" ? "/" : `/?${query}`);
}
