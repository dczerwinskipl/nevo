using System.Text.Json;
using LanguageExt;
using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

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
        if (userContext.User.IsNone)
        {
            if (context.Headers.TryGetValue("user-context", out string? userContextDataJson))
            {
                try
                {
                    // TODO: extract serializer/deserializer and validate
                    var jsonDoc = JsonDocument.Parse(userContextDataJson);
                    var userElement = jsonDoc.RootElement.GetProperty("user");
                    var rolesElement = jsonDoc.RootElement.GetProperty("userRoles");

                    var user = JsonSerializer.Deserialize<User<TId>>(userElement, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    var userRoles = JsonSerializer.Deserialize<List<Role<TRoleDataScope>>>(rolesElement, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                    userContext.User = user;
                    userContext.UserRoles = userRoles!;
                    userContext.UserPermissions = _permissionProvider.GetPermissions(userRoles!);
                }
                catch
                {
                    return Task.FromResult<Either<Exception, object>>(new Exception("Invalid header user context data"));
                }
            }
            else
            {
                userContext.User = _userProvider.GetUser();

                var userRoles = _roleProvider.GetRoles();
                userContext.UserRoles = userRoles;
                userContext.UserPermissions = _permissionProvider.GetPermissions(userRoles);
            }
        }

        return next();
    }
}

