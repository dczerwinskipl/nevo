using NEvo.Ddd.EventSourcing.Tests.Mocks;
using NEvo.ExampleApp.ServiceA.Api.ExampleDomain;
using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

namespace Microsoft.AspNetCore.Routing;

public static class Routes
{
    public static WebApplication MapServiceARoutes(this WebApplication app)
    {
        app.MapMessagesEndpoints().RequireAuthorization();
        app.MapCommandEndpoint<SayHelloCommand>("/api/hello").RequireAuthorization();
        app.MapCommandEndpoint<SayHelloCommand>("/api/hello_noAuth");
        app.MapCommandEndpoint<ServiceBCommand>("/api/world").RequireAuthorization();
        app.MapCommandEndpoint<ServiceBCommand>("/api/world_noAuth");
        app.MapCommandEndpoint<CreateDocument>("/api/document/create");
        return app;
    }
}
