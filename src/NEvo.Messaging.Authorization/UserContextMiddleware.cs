using System.Text.Json;
using LanguageExt;
using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

using static LanguageExt.Prelude;

namespace NEvo.Messaging.Authorization;

public class UserContextMiddleware<TId, TRoleDataScope>(
    IUserProvider<TId> userProvider,
    IRoleProvider<TRoleDataScope> roleProvider,
    IPermissionProvider<TRoleDataScope> permissionProvider
) : IMessageProcessingMiddleware where TRoleDataScope : AuthDataScope
{
    private readonly IUserProvider<TId> _userProvider = Check.Null(userProvider);
    private readonly IRoleProvider<TRoleDataScope> _roleProvider = Check.Null(roleProvider);
    private readonly IPermissionProvider<TRoleDataScope> _permissionProvider = Check.Null(permissionProvider);

    public Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var userContext = context.GetUserContext<TId>();
        ResolveUserWithRoles(context)
            .Iter((userWithRoles) => PopulateUserContext(userContext, userWithRoles));

        return next();
    }
    private Option<UserWithRoles> ResolveUserWithRoles(IMessageContext context) =>
        UserHeader(context)
            .Match(
                Some: Some,
                None: FromProviders
            );

    private static Option<UserWithRoles> UserHeader(IMessageContext context)
        => Optional(
                // todo: use a constant for the header name
                // todo: add check if we should use header data or not
                context.Headers.TryGetValue("user-context", out string? userContextDataJson)
                ? userContextDataJson
                : null
            ).Bind(PraseHeaderContext);

    private static Option<UserWithRoles> PraseHeaderContext(string userContextDataJson)
        => Try(() => JsonSerializer.Deserialize<UserWithRoles>(
                userContextDataJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            )).Match(
                Succ: Some,
                Fail: _ => None
            );

    private Option<UserWithRoles> FromProviders()
        => _userProvider
            .GetUser()
            .Map(user => new UserWithRoles(user, _roleProvider.GetRoles()));

    private void PopulateUserContext(UserContext<TId> userContext, UserWithRoles userWithRoles)
    {
        userContext.User = userWithRoles.User;
        userContext.UserRoles = userWithRoles.Roles;
        userContext.UserPermissions = _permissionProvider.GetPermissions(userWithRoles.Roles);
    }

    private record UserWithRoles(User<TId> User, IEnumerable<Role<TRoleDataScope>> Roles);
}

