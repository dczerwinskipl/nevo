using NEvo.ExampleApp.Documents.Api.Domain;

namespace NEvo.ExampleApp.Documents.Api;

public static class Routes
{
    /// <summary>Maps the Documents example's command and query HTTP endpoints.</summary>
    /// <remarks>
    /// <c>RequireAuthorization()</c> on the approve endpoint and the <c>ApproveDocument</c>
    /// permission requirement are independent gates: the former only requires an
    /// authenticated caller; the latter is enforced separately by the message-level
    /// permission pipeline.
    /// </remarks>
    public static WebApplication MapDocumentsRoutes(this WebApplication app)
    {
        app.MapCommandEndpoint<CreateDocument>("/api/documents");
        app.MapCommandEndpoint<ChangeDocument>("/api/documents/change");
        app.MapCommandEndpoint<ApproveDocument>("/api/documents/approve").RequireAuthorization();
        app.MapQueryEndpoint<GetDocumentQuery, DocumentDto>("/api/documents/{documentId:guid}");
        return app;
    }
}
