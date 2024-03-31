using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

namespace Microsoft.AspNetCore.Routing;

public static class Routes
{
    public static WebApplication MapServiceBRoutes(this WebApplication app)
    {
        app.MapMessagesEndpoints();
        app.MapCommandEndpoint<ServiceBCommand>("/api/hello");
        return app;
    }
}
