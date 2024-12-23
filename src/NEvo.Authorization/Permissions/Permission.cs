namespace NEvo.Authorization.Permissions;

public record Permission<T>(
    string Name,
    T DataScope
) : IPermission where T : AuthDataScope;
