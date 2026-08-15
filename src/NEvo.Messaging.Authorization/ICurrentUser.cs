using NEvo.Authorization.Users;

namespace NEvo.Messaging.Authorization;

/// <summary>
/// The current, authenticated caller's identity — identity only, never roles,
/// permissions, or any other authorization state. Authorization enforcement stays the
/// responsibility of <see cref="ValidatePermissionMiddleware{TId, TUser}"/> and the
/// message-level/handler-level permission pipeline.
/// </summary>
/// <remarks>
/// Non-optional by design: declaring <see cref="ICurrentUser{TId, TUser}"/> as a
/// decision-method parameter (or any other consumption point) is the assertion that a
/// current user is required. A resolved <see cref="ICurrentUser{TId, TUser}"/> always
/// carries a real user; when none is available, resolving it fails clearly (see
/// <see cref="CurrentUserUnavailableException"/>) rather than returning an absence the
/// caller must check for.
/// </remarks>
public interface ICurrentUser<TId, TUser> where TUser : User<TId>
{
    TUser User { get; }
}
