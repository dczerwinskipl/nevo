using Microsoft.EntityFrameworkCore;
using NEvo.ExampleApp.ServiceA.Api.Database;
using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;
using NEvo.Messaging.Handling.Middleware;

const string AppName = "NEvo.ExampleApp.ServiceA.Api";

var builder = WebApplication.CreateBuilder(args);

// logging
builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

// database
builder.Services.AddDbContext<ExampleDbContext>();

// nEvo (TODO: presets)
builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddEvents();
builder.Services.AddCommands();
builder.Services.AddRestMessageDispatcher((opts) =>
{
    opts.Name = "ServiceB/RestMessageDispatcher";
    opts.BaseAddress = "http://localhost:64632/api/messages/";
}, [typeof(ServiceBCommand)]);


// nEvo Inbox, maybe single method + config like UseEntityFramework<TContext>?
// example api: nEvoBuilder.UseInbox(options => options.UseEntityFramework<ExampleDbContext>());
builder.Services.AddMessageProcessingMiddleware<TransactionScopeMessageProcessingMiddleware>();
builder.Services.AddMessageProcessingMiddleware<InboxMessageProcessingMiddleware>();
builder.Services.AddMessageProcessingHandlerMiddleware<InboxMessageProcessingMiddleware>();
builder.Services.AddEntityFrameworkInbox<ExampleDbContext>();

// swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(setup =>
{
    setup.SwaggerDoc("v1", new() { Title = AppName, Version = "v1" });
});

var app = builder.Build();

// register handlers (TODO: change to setup of messaging)
var registry = app.Services.GetRequiredService<IMessageHandlerRegistry>();
registry.UseServiceADomain();

// app routes
app.MapServiceARoutes();

// swagger
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "v1");
    options.RoutePrefix = string.Empty;
});

// migrate db
using (var scope = app.Services.CreateScope())
{
    await scope.ServiceProvider.GetRequiredService<ExampleDbContext>().Database.MigrateAsync();
}

app.Run();

