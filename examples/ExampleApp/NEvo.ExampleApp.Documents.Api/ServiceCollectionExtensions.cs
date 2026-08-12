using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;
using NEvo.ExampleApp.Documents.Api.Authorization;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Handling;

namespace NEvo.ExampleApp.Documents.Api;

public static class ServiceCollectionExtensions
{
    /// <summary>Registers the Documents example's application-specific handlers.</summary>
    public static IServiceCollection AddDocumentsDomain(this IServiceCollection serviceCollection)
    {
        serviceCollection.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(GetDocumentQueryHandler));
        });

        return serviceCollection;
    }

    /// <summary>
    /// Wires message-level permission enforcement for <c>ApproveDocument</c>: a demo
    /// authentication scheme (see <see cref="Authorization.DemoAuthenticationHandler"/>)
    /// plus the <c>UserContextMiddleware</c>/<c>ValidatePermissionMiddleware</c> pipeline.
    /// </summary>
    public static IServiceCollection AddDocumentsAuthorization(this IServiceCollection serviceCollection)
    {
        serviceCollection.AddHttpContextAccessor();
        serviceCollection
            .AddAuthentication(DemoAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, DemoAuthenticationHandler>(DemoAuthenticationHandler.SchemeName, _ => { });
        serviceCollection.AddAuthorization();

        serviceCollection.AddScoped<IUserProvider<Guid>, DemoUserProvider>();
        serviceCollection.AddScoped<IRoleProvider<DocumentDataScope>, DemoRoleProvider>();
        serviceCollection.AddScoped<IPermissionProvider<DocumentDataScope>, PermissionProvider<DocumentDataScope>>();
        serviceCollection.AddSingleton<IPermissionMapper<DocumentDataScope>, ApproverPermissionMapper>();
        serviceCollection.AddCurrentUser<Guid>();

        serviceCollection.AddMessageProcessingMiddleware<UserContextMiddleware<Guid, DocumentDataScope>>();
        serviceCollection.AddMessageProcessingHandlerMiddleware<ValidatePermissionMiddleware<Guid>>();

        return serviceCollection;
    }
}
