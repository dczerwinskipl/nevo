using NEvo.ExampleApp.Documents.Api.Domain;

namespace Microsoft.AspNetCore.Routing;

public static class Routes
{
    public static WebApplication MapDocumentsRoutes(this WebApplication app)
    {
        app.MapCommandEndpoint<CreateDocument>("/api/documents");
        app.MapCommandEndpoint<ChangeDocument>("/api/documents/change");
        // Message-level permission (task 07) + ASP.NET Core's own RequireAuthorization()
        // are independent gates: RequireAuthorization() only requires *an* authenticated
        // caller (the DemoAuthenticationHandler scheme); ValidatePermissionMiddleware,
        // wired in ServiceCollectionExtensions.AddDocumentsAuthorization, separately
        // enforces the ApproveDocument permission itself.
        app.MapCommandEndpoint<ApproveDocument>("/api/documents/approve").RequireAuthorization();
        app.MapQueryEndpoint<GetDocumentQuery, DocumentDto>("/api/documents/{documentId:guid}");
        return app;
    }
}
