﻿using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;
using System.Collections.Immutable;
using System.Security.Claims;

namespace NEvo.ExampleApp.Identity.Api;

public static class Routes
{
    public static WebApplication MapOAuthRoutes(this WebApplication app)
    {
        app.MapPost("/connect/token", async (HttpContext httpContext, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager) =>
        {
            var openIddictRequest = httpContext.GetOpenIddictServerRequest();
            if (openIddictRequest?.IsPasswordGrantType() == true)
            {
                var user = await userManager.FindByNameAsync(openIddictRequest.Username!);
                if (user == null)
                {
                    return Results.Unauthorized();
                }

                var result = await signInManager.CheckPasswordSignInAsync(user, openIddictRequest.Password!, lockoutOnFailure: false);
                if (!result.Succeeded)
                {
                    return Results.Unauthorized();
                }

                var identity = new ClaimsIdentity(
                   TokenValidationParameters.DefaultAuthenticationType,
                   OpenIddictConstants.Claims.Name,
                   OpenIddictConstants.Claims.Role);

                identity.AddClaim(OpenIddictConstants.Claims.Subject, user.Id.ToString(), OpenIddictConstants.Destinations.AccessToken);
                identity.AddClaim(OpenIddictConstants.Claims.Username, user.UserName!, OpenIddictConstants.Destinations.AccessToken);
                identity.AddClaim(OpenIddictConstants.Claims.Name, user.UserName!, OpenIddictConstants.Destinations.AccessToken);

                // hardcoded for testing
                identity.AddClaim(OpenIddictConstants.Claims.Role, """{ "name": "Manager", "dataScope": { "tenantId": "T1", "companyId": "*" } }""", OpenIddictConstants.Destinations.AccessToken);
                identity.AddClaim(OpenIddictConstants.Claims.Role, """{ "name": "Admin", "dataScope": { "tenantId": "T1", "companyId": "C1" } }""", OpenIddictConstants.Destinations.AccessToken);
                identity.AddClaim(OpenIddictConstants.Claims.Role, """{ "name": "Invalid", "dataScope": { "companyId": "C1" } }""", OpenIddictConstants.Destinations.AccessToken);
                // Add more claims if necessary

                /*
                foreach (var userRole in user.UserRoles)
                {
                    identity.AddClaim(OpenIddictConstants.Claims.Role, userRole.Role.NormalizedName, OpenIddictConstants.Destinations.AccessToken);
                }*/

                var claimsPrincipal = new ClaimsPrincipal(identity);
                claimsPrincipal.SetScopes(new string[]
                {
                    OpenIddictConstants.Scopes.Roles,
                    OpenIddictConstants.Scopes.OfflineAccess,
                    OpenIddictConstants.Scopes.Email,
                    OpenIddictConstants.Scopes.Profile,
                });

                var destinations = new Dictionary<string, string[]>
                {
                    { OpenIddictConstants.Claims.Subject, [OpenIddictConstants.Destinations.AccessToken] },
                    { OpenIddictConstants.Claims.Username, [OpenIddictConstants.Destinations.AccessToken] },
                    { OpenIddictConstants.Claims.Name, [OpenIddictConstants.Destinations.AccessToken] },
                    { OpenIddictConstants.Claims.Role, [OpenIddictConstants.Destinations.AccessToken] }
                }.ToImmutableDictionary();
                claimsPrincipal.SetDestinations(destinations);

                // Assuming configuration for OpenIddict to issue tokens is done in ConfigureServices
                return Results.SignIn(claimsPrincipal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
            }

            // Handle other grant types or return an error
            return Results.BadRequest(new OpenIddictResponse
            {
                Error = OpenIddictConstants.Errors.UnsupportedGrantType
            });
        });
        return app;
    }

    public static WebApplication MapIdentityRoutes(this WebApplication app)
    {
        app.MapPost("/register", async (UserRegistrationModel model, UserManager<IdentityUser> userManager) =>
            {
                var user = new IdentityUser { UserName = model.Username, Email = model.Email };
                var result = await userManager.CreateAsync(user, model.Password);

                if (!result.Succeeded)
                {
                    return Results.ValidationProblem(result.Errors.ToDictionary(e => e.Code, e => new string[] { e.Description }));
                }

                return Results.Ok();
            })
            .WithName("RegisterUser");
        return app;
    }
}
