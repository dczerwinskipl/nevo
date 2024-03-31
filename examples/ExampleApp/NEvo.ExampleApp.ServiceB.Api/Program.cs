using Microsoft.EntityFrameworkCore;
using NEvo.ExampleApp.ServiceB.Api.Database;
using NEvo.Messaging.Handling.Middleware;

const string AppName = "NEvo.ExampleApp.ServiceB.Api";

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

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

app.MapDefaultEndpoints();

// register handlers (TODO: change to setup of messaging)
var registry = app.Services.GetRequiredService<IMessageHandlerRegistry>();
registry.UseExampleDomain();

// app routes
app.MapServiceBRoutes();

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