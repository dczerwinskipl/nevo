namespace NEvo.Authorization.Roles;

public interface IRoleProvider<T> where T : AuthDataScope
{
    public IEnumerable<Role<T>> GetRoles();
}
