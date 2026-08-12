using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// Adapts <see cref="IMessageContextAccessor"/>/<see cref="UserContext{TId}"/> into the
/// narrow <see cref="ICurrentUser{TId}"/> capability — consumers of
/// <see cref="ICurrentUser{TId}"/> read identity through this adapter instead of calling
/// <see cref="MessageContextExtensions.GetUserContext{TId}"/> directly.
/// </summary>
internal sealed class CurrentUser<TId>(IMessageContextAccessor messageContextAccessor) : ICurrentUser<TId>
{
    public Option<User<TId>> User =>
        messageContextAccessor.MessageContext?.GetUserContext<TId>().User ?? Option<User<TId>>.None;
}
