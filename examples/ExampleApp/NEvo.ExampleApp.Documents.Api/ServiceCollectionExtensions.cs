using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.Authorization.Users;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.ExampleApp.Documents.Api.Authorization;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Handling;

namespace NEvo.ExampleApp.Documents.Api;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDocumentsDomain(this IServiceCollection serviceCollection)
    {
        // CreateDocument/ChangeDocument have no explicit handler — the aggregate-method
        // convention (Level 1, Fallback) routes them. ApproveDocument has the Level 2
        // handler below registered as Primary, so its own convention decider
        // (EditableDocument.Approve) stays a discovered-but-unused Fallback (D3).
        serviceCollection.AddScoped<IEventSourcedCommandHandler<ApproveDocument, Document, Guid>, ApproveDocumentHandler>();

        serviceCollection.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(GetDocumentQueryHandler));
            options.Handlers.Add(typeof(ApproveDocumentHandler));
        });

        return serviceCollection;
    }

    // Wires message-level permission enforcement (task 07) for ApproveDocument: a demo
    // authentication scheme (see Authorization/DemoAuthentication.cs) plus the same
    // UserContextMiddleware/ValidatePermissionMiddleware pipeline ServiceA.Api uses for
    // SayHelloCommand.
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

        serviceCollection.AddMessageProcessingMiddleware<UserContextMiddleware<Guid, DocumentDataScope>>();
        serviceCollection.AddMessageProcessingHandlerMiddleware<ValidatePermissionMiddleware<Guid>>();

        return serviceCollection;
    }
}
