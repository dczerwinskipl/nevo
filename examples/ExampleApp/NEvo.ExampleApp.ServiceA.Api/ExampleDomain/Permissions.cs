using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Messaging.Authorization;

namespace NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

public static class Permissions
{
    public const string SayHello = "SAY_HELLO";
}

public interface ISayCommand
{
    public string CompanyId { get; }
}

public record SayDataScope(string CompanyId) : AuthDataScope;

// just texample
public class SayHelloPermissionMapper : IPermissionMapper<RoleDataScope>
{
    private string[] Roles = ["Admin"];

    public bool CanMapRole(Role<RoleDataScope> role)
    {
        return Roles.Contains(role.Name);
    }

    public IEnumerable<IPermission> MapRole(Role<RoleDataScope> role)
    {
        yield return new Permission<SayDataScope>(Permissions.SayHello, new SayDataScope(role.DataScope.CompanyId));
    }
}

public class SayDataScopeValidator<TMessage> : IDataScopeMessageValidator<SayDataScope, TMessage>
    where TMessage : Command, ISayCommand
{
    public bool Validate(SayDataScope dataScope, TMessage message)
        => dataScope.CompanyId.AllowedFor(message.CompanyId);
}