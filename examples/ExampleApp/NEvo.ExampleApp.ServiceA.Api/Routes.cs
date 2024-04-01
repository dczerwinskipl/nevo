﻿using NEvo.ExampleApp.ServiceA.Api.ExampleDomain;
using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

namespace Microsoft.AspNetCore.Routing;

public static class Routes
{
    public static WebApplication MapServiceARoutes(this WebApplication app)
    {
        app.MapMessagesEndpoints().RequireAuthorization();
        app.MapCommandEndpoint<ServiceACommand>("/api/hello").RequireAuthorization();
        app.MapCommandEndpoint<ServiceBCommand>("/api/world").RequireAuthorization();
        return app;
    }
}
