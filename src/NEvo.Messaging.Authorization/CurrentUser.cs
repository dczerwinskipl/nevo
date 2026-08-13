using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// Adapts <see cref="IMessageContextAccessor"/>/<see cref="UserContext{TId, TUser}"/>
/// into the narrow <see cref="ICurrentUser{TId, TUser}"/> capability — consumers of
/// <see cref="ICurrentUser{TId, TUser}"/> read identity through this adapter instead of
/// calling <see cref="MessageContextExtensions.GetUserContext{TId, TUser}"/> directly.
/// Fails with <see cref="CurrentUserUnavailableException"/> during construction when no
/// current user is actually available, so a consumer resolved through DI never observes
/// a partially-usable instance — <see cref="User"/> is a plain, already-validated read.
/// </summary>
internal sealed class CurrentUser<TId, TUser> : ICurrentUser<TId, TUser> where TUser : User<TId>
{
    public TUser User { get; }

    public CurrentUser(IMessageContextAccessor messageContextAccessor)
    {
        var context = messageContextAccessor.MessageContext
            ?? throw new CurrentUserUnavailableException("No active message context is available.");

        User = context.GetUserContext<TId, TUser>().User
            .IfNone(() => throw new CurrentUserUnavailableException("No current user is available for this message invocation."));
    }
}
