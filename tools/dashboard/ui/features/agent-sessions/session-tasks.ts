export interface SessionTaskItem {
  id: string;
  title?: string;
  isClickable?: boolean;
}

export function resolveSessionTaskItems(
  session: { taskIds?: string[]; taskId?: string } | null | undefined,
  tasks?: Array<{ id: string; title?: string }> | null,
): SessionTaskItem[] {
  const rawTaskIds =
    session?.taskIds && session.taskIds.length > 0 ? session.taskIds : session?.taskId ? [session.taskId] : [];
  if (!rawTaskIds.length) return [];
  return rawTaskIds.map((taskId) => {
    const matchedTask = tasks?.find((t) => t.id === taskId);
    return {
      id: taskId,
      title: matchedTask?.title || taskId,
      isClickable: Boolean(matchedTask),
    };
  });
}
