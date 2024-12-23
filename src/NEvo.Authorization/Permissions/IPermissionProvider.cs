using NEvo.Authorization.Roles;

namespace NEvo.Authorization.Permissions;

public interface IPermissionProvider<T> where T : AuthDataScope
{
    public IEnumerable<IPermission> GetPermissions(IEnumerable<Role<T>> roles);
}

public class PermissionProvider<T>(
    IEnumerable<IPermissionMapper<T>> permissionMappers
) : IPermissionProvider<T> where T : AuthDataScope
{
    public IEnumerable<IPermission> GetPermissions(IEnumerable<Role<T>> roles)
    {
        var permissions = new List<IPermission>();
        foreach (var role in roles)
        {
            foreach (var permissionMapper in permissionMappers)
            {
                if (permissionMapper.CanMapRole(role))
                {
                    permissions.AddRange(permissionMapper.MapRole(role));
                }
            }
        }
        return permissions;
    }
}

public interface IPermissionMapper<T> where T : AuthDataScope
{
    public bool CanMapRole(Role<T> role);
    public IEnumerable<IPermission> MapRole(Role<T> role);
}