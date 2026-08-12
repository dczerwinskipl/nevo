namespace NEvo.Messaging.Authorization;

/// <summary>
/// Thrown when <see cref="ICurrentUser{TId, TUser}"/> is resolved but no current user is
/// actually available for the invocation (no active message context, or an unpopulated
/// <see cref="UserContext{TId, TUser}"/>). Declaring <see cref="ICurrentUser{TId, TUser}"/>
/// as a decision-method parameter asserts that a current user is required — this
/// exception is what the aggregate-method convention's parameter resolver (<c>NEvo.Ddd.
/// EventSourcing</c>) catches and represents as its own typed resolution failure, so the
/// decision method is never invoked without one.
/// </summary>
public sealed class CurrentUserUnavailableException(string message) : InvalidOperationException(message);
