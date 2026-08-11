// Edge-runtime server wrapper so @cloudflare/next-on-pages can render this
// dynamic route as a Cloudflare edge function. The actual UI lives in ./view
// (a client component); we forward the route params unchanged.
import UserDetailView from './view';

export const runtime = 'edge';

export default function Page({ params }: { params: { id: string } }) {
  return <UserDetailView params={params} />;
}
