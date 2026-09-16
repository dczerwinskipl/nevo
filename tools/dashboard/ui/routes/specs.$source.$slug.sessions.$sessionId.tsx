import { createFileRoute } from '@tanstack/react-router';
import { AgentSessionScreen } from '@/screens/agent-session/agent-session-screen';

export const Route = createFileRoute('/specs/$source/$slug/sessions/$sessionId')({
  component: AgentSessionRouteEntry,
});

function AgentSessionRouteEntry() {
  const { source, slug, sessionId } = Route.useParams();
  return <AgentSessionScreen source={source} slug={slug} sessionId={sessionId} />;
}
