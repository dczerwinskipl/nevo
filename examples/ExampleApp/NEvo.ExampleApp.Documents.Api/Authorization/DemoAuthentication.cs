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

/// <summary>
/// Minimal demo-only authentication scheme: a request is authenticated when it carries
/// the <see cref="UserIdHeader"/> header, with <see cref="RolesHeader"/> mapped to
/// claims-based roles. This lets the example demonstrate <c>RequireAuthorization()</c>
/// together with NEvo's message-level permission pipeline end to end from a single
/// <c>dotnet run</c>, without standing up a real identity provider.
/// </summary>
/// <remarks>This is not intended as a production authentication mechanism.</remarks>
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

/// <summary> A demo user for the Documents example, with a <see cref="Guid"/> ID and a name. </summary>
public record DemoUser(Guid Id, string Name) : User<Guid>(Id, Name);

/// <summary>Adapts the identity <see cref="DemoAuthenticationHandler"/> puts on <c>HttpContext.User</c> to a NEvo <see cref="User{TId}"/> for authorization.</summary>
public class DemoUserProvider(IHttpContextAccessor httpContextAccessor) : IUserProvider<DemoUser, Guid>
{
    public Option<DemoUser> GetUser()
    {
        var idClaim = httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return idClaim is not null && Guid.TryParse(idClaim, out var id)
            ? Option<DemoUser>.Some(new DemoUser(id, idClaim))
            : Option<DemoUser>.None;
    }
}

/// <summary>Adapts the role claims <see cref="DemoAuthenticationHandler"/> puts on <c>HttpContext.User</c> to NEvo roles for authorization.</summary>
public class DemoRoleProvider(IHttpContextAccessor httpContextAccessor) : IRoleProvider<DocumentDataScope>
{
    public IEnumerable<Role<DocumentDataScope>> GetRoles()
        => httpContextAccessor.HttpContext?.User.FindAll(ClaimTypes.Role)
            .Select(claim => new Role<DocumentDataScope>(claim.Value, new DocumentDataScope()))
            ?? Enumerable.Empty<Role<DocumentDataScope>>();
}
