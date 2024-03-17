using NEvo.ExampleApp.ExampleDomain;
using NEvo.Messaging.Handling.Middleware;

const string AppName = "NEvo.ExampleApp";

var builder = WebApplication.CreateBuilder(args);

// logging
builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

// nEvo (TODO: presets)
builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddEvents();
builder.Services.AddCommands();

// swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(setup =>
{
    setup.SwaggerDoc("v1", new() { Title = AppName, Version = "v1" });
});

var app = builder.Build();

// register handlers (TODO: change to setup of messaging)
var registry = app.Services.GetRequiredService<IMessageHandlerRegistry>();
registry.UseExampleDomain();

// Hello world (remove it later)
app.MapGet("/api/helloWorld", () => "Hello World!")
    .WithName("GetHelloWorld")
    .WithOpenApi();

// example post with message (TODO: use MessageBus, not processor directly)
app.MapPost("/api/helloWorld", async (MyCommand command, CancellationToken token, ICommandDispatcher commandDispatcher) =>
    {    
        var result = await commandDispatcher.DispatchAsync(command, token);
    
        result.Match(
            Right: _ => Console.WriteLine($"Success: {command.Id}"),
            Left: ex => Console.WriteLine($"Failure: {command.Id}, message: {ex.Message}")
        );

        return result.Match(
           Right: _ => Results.Ok(),
           Left: ex => Results.Problem(detail: ex.Message, statusCode: 500)
        );
    })
    .WithName("PostHelloWorld")
    .WithOpenApi();

// swagger
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "v1");
    options.RoutePrefix = string.Empty;
});

app.Run();

