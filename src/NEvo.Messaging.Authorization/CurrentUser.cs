using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// Adapts <see cref="IMessageContextAccessor"/>/<see cref="UserContext{TId, TUser}"/>
/// into the narrow <see cref="ICurrentUser{TId, TUser}"/> capability — consumers of
/// <see cref="ICurrentUser{TId, TUser}"/> read identity through this adapter instead of
/// calling <see cref="MessageContextExtensions.GetUserContext{TId, TUser}"/> directly.
/// Fails with <see cref="CurrentUserUnavailableException"/> when no current user is
/// actually available, rather than returning an absence for the caller to check.
/// </summary>
internal sealed class CurrentUser<TId, TUser>(IMessageContextAccessor messageContextAccessor) : ICurrentUser<TId, TUser> where TUser : User<TId>
{
    public TUser User
    {
        get
        {
            var context = messageContextAccessor.MessageContext
                ?? throw new CurrentUserUnavailableException("No active message context is available.");

            return context.GetUserContext<TId, TUser>().User
                .IfNone(() => throw new CurrentUserUnavailableException("No current user is available for this message invocation."));
        }
    }
}
