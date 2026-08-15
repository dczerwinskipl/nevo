namespace NEvo.Messaging.Authorization;

/// <summary>
/// A message- or handler-level <c>[AllowPermission]</c> requirement was not satisfied.
/// Derives from the BCL's <see cref="UnauthorizedAccessException"/> so a transport layer
/// (e.g. <c>NEvo.Messaging.Web</c>) can recognize and map it without a new project
/// reference to this package.
/// </summary>
public sealed class PermissionDeniedException : UnauthorizedAccessException
{
    public PermissionDeniedException()
        : base("Permission denied.")
    {
    }
}
