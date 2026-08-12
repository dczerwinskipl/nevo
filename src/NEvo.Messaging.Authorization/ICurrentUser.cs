using LanguageExt;
using NEvo.Authorization.Users;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// The current, authenticated caller's identity — identity only, never roles,
/// permissions, or any other authorization state. Authorization enforcement stays the
/// responsibility of <see cref="ValidatePermissionMiddleware{TId}"/> and the message-
/// level/handler-level permission pipeline.
/// </summary>
public interface ICurrentUser<TId>
{
    Option<User<TId>> User { get; }
}
