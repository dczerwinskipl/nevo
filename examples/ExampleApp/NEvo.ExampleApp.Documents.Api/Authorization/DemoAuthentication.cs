using System.Security.Claims;
using System.Text.Encodings.Web;
using LanguageExt;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;

namespace NEvo.ExampleApp.Documents.Api.Authorization;

// Minimal demo-only authentication scheme: a request is authenticated when it carries
// the X-Demo-User-Id header. This lets the example demonstrate RequireAuthorization()
// together with NEvo's own message-level permission pipeline (AllowPermission /
// ValidatePermissionMiddleware / UserContextMiddleware) end to end from a single
// `dotnet run`, without standing up Identity.Api/JWT bearer auth the way ServiceA.Api
// does — that would pull in a real identity-provider dependency this compact example
// doesn't need. A real service should use a real scheme instead.
public class DemoAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder
) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "DocumentsDemo";
    public const string UserIdHeader = "X-Demo-User-Id";
    public const string RolesHeader = "X-Demo-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserIdHeader, out var userId) || !Guid.TryParse(userId, out _))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId!) };
        if (Request.Headers.TryGetValue(RolesHeader, out var roles))
        {
            claims.AddRange(roles.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(role => new Claim(ClaimTypes.Role, role)));
        }

        var identity = new ClaimsIdentity(claims, authenticationType: SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}

// Reads the identity DemoAuthenticationHandler put on HttpContext.User. Kept local
// rather than reusing NEvo.Web.Authorization's ClaimUserProvider/ClaimRoleProvider,
// since those expect roles as a JSON-encoded Role<T> claim value — this demo scheme
// uses plain role-name claims instead, for a walkthrough that stays curl-friendly.
public class DemoUserProvider(IHttpContextAccessor httpContextAccessor) : IUserProvider<Guid>
{
    public Option<User<Guid>> GetUser()
    {
        var idClaim = httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return idClaim is not null && Guid.TryParse(idClaim, out var id)
            ? Option<User<Guid>>.Some(new User<Guid>(id, idClaim))
            : Option<User<Guid>>.None;
    }
}

public class DemoRoleProvider(IHttpContextAccessor httpContextAccessor) : IRoleProvider<DocumentDataScope>
{
    public IEnumerable<Role<DocumentDataScope>> GetRoles()
        => httpContextAccessor.HttpContext?.User.FindAll(ClaimTypes.Role)
            .Select(claim => new Role<DocumentDataScope>(claim.Value, new DocumentDataScope()))
            ?? Enumerable.Empty<Role<DocumentDataScope>>();
}
