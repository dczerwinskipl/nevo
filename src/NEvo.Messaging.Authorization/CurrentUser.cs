using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// Adapts <see cref="IMessageContextAccessor"/>/<see cref="UserContext{TId}"/> into
/// <see cref="ICurrentUser{TId}"/> — the only place this internal representation is
/// read; consumers of <see cref="ICurrentUser{TId}"/> never call
/// <see cref="MessageContextExtensions.GetUserContext{TId}"/> themselves.
/// </summary>
internal sealed class CurrentUser<TId>(IMessageContextAccessor messageContextAccessor) : ICurrentUser<TId>
{
    public Option<User<TId>> User =>
        messageContextAccessor.MessageContext?.GetUserContext<TId>().User ?? Option<User<TId>>.None;
}
