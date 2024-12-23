using System.ComponentModel.DataAnnotations;

namespace NEvo.Authorization.Roles;

public record Role<T>(
    string Name,
    T DataScope
) : IRole where T : AuthDataScope;
