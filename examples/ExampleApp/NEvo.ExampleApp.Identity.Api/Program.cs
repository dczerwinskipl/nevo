using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Logging;
using NEvo.ExampleApp.Identity.Api;
using NEvo.ExampleApp.Identity.Api.Database;
using OpenIddict.Abstractions;
using Polly;

IdentityModelEventSource.ShowPII = true;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// Database
builder.AddSqlServerDbContext<ExampleAppIdentityDbContext>("IdentitySql",
    settings => settings.Retry = false,
    options =>
    {
        options.UseOpenIddict();
    });

// Identity
builder.Services.AddIdentity<IdentityUser, IdentityRole>()
    .AddSignInManager()
    .AddEntityFrameworkStores<ExampleAppIdentityDbContext>()
    .AddDefaultTokenProviders();

builder.Services
    .Configure<IdentityOptions>(options =>
    {
        options.ClaimsIdentity.UserNameClaimType = OpenIddictConstants.Claims.Name;
        options.ClaimsIdentity.UserIdClaimType = OpenIddictConstants.Claims.Subject;
        options.ClaimsIdentity.RoleClaimType = OpenIddictConstants.Claims.Role;
    });

// OpenIddict
builder.Services.AddOpenIddict()
    .AddCore(options =>
    {
        options.UseEntityFrameworkCore()
               .UseDbContext<ExampleAppIdentityDbContext>();
    })
    .AddServer(options =>
    {
        options.AllowPasswordFlow()
               .AllowRefreshTokenFlow()
               .AllowClientCredentialsFlow();

        options.SetTokenEndpointUris("/connect/token");
        options.SetUserinfoEndpointUris("/connect/userinfo");

        options.AcceptAnonymousClients();

        options.RegisterScopes(
            OpenIddictConstants.Permissions.Scopes.Email,
            OpenIddictConstants.Permissions.Scopes.Profile,
            OpenIddictConstants.Permissions.Scopes.Roles
        );

        options.SetAccessTokenLifetime(TimeSpan.FromMinutes(30));
        options.SetRefreshTokenLifetime(TimeSpan.FromDays(7));

        // sign and  encrypt
        options.DisableAccessTokenEncryption()
               .AddDevelopmentSigningCertificate();

        // Register ASP.NET Core host and configuration options
        options
            .UseAspNetCore()
            .EnableTokenEndpointPassthrough();
    })
    .AddValidation(options =>
    {
        options.UseLocalServer();
        options.UseAspNetCore();
    });

builder.Services.AddCors(options =>
{
    if (builder.Environment.IsDevelopment())
    {
        options.AddDefaultPolicy(policy =>
            policy.SetIsOriginAllowed(origin => new Uri(origin).Host == "localhost")
               .AllowAnyMethod()
               .AllowAnyHeader()
               .AllowCredentials());
    }
});

builder.Services.AddAuthentication(options =>
{
    options.DefaultScheme = OpenIddictConstants.Schemes.Bearer;
    options.DefaultChallengeScheme = OpenIddictConstants.Schemes.Bearer;
});
builder.Services.AddAuthorization();

// swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(setup =>
{
    setup.SwaggerDoc("v1", new() { Title = "Identity Api", Version = "v1" });
});

var app = builder.Build();

app.MapDefaultEndpoints();

// Configure the HTTP request pipeline.
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapIdentityRoutes();
app.MapOAuthRoutes();

if (app.Environment.IsDevelopment())
{
    // swagger
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "v1");
        options.RoutePrefix = string.Empty;
    });
}

// db migration
var logger = app.Services.GetRequiredService<ILogger<Program>>();
var retryPolicy = Policy
    .Handle<Exception>()
    .WaitAndRetryAsync(
        10,
        retryAttempt => TimeSpan.FromSeconds(retryAttempt),
        onRetry: (exception, timeSpan, retryCount, context) =>
        {
            logger.LogWarning($"Retry {retryCount}: Encountered an error during DB migration. Retrying...");
            logger.LogWarning($"Exception: {exception.Message}");
        });

await retryPolicy.ExecuteAsync(async () =>
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<ExampleAppIdentityDbContext>();
    await dbContext.Database.MigrateAsync();

    var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
    var existingClientApp = manager.FindByClientIdAsync("nEvo-app").GetAwaiter().GetResult();
    if (existingClientApp == null)
    {
        manager.CreateAsync(new OpenIddictApplicationDescriptor
        {
            ClientId = "nEvo-app",
            ClientSecret = "499D56FA-B47B-5199-BA61-B298D431C318",
            DisplayName = "Default client application",
            Permissions =
            {
                OpenIddictConstants.Permissions.Endpoints.Token,
                OpenIddictConstants.Permissions.GrantTypes.Password
            }
        }).GetAwaiter().GetResult();
    }
});

app.Run();


public record UserRegistrationModel(string Username, string Email, string Password);