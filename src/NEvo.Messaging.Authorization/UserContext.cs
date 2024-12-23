using LanguageExt;
using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;

namespace NEvo.Messaging.Authorization;

public class UserContext<TId>
{
    public Option<User<TId>> User { get; set; }

    public IEnumerable<IRole> UserRoles { get; set; } = [];

    public IEnumerable<IPermission> UserPermissions { get; set; } = [];

    public IEnumerable<Role<TDataScope>> GetRoles<TDataScope>() where TDataScope : AuthDataScope
        => UserRoles.OfType<Role<TDataScope>>();

    public Option<Role<TDataScope>> GetRole<TDataScope>(string roleName) where TDataScope : AuthDataScope
        => UserRoles.OfType<Role<TDataScope>>().FirstOrDefault(x => x.Name == roleName);

    public IEnumerable<Permission<TDataScope>> GetPermissions<TDataScope>() where TDataScope : AuthDataScope
        => UserPermissions.OfType<Permission<TDataScope>>();

    public Option<Permission<TDataScope>> GetPermission<TDataScope>(string permissionName) where TDataScope : AuthDataScope
        => UserPermissions.OfType<Permission<TDataScope>>().FirstOrDefault(x => x.Name == permissionName);
}
