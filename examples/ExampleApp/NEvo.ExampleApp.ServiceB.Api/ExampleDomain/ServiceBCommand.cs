using System.Text.Json.Serialization;

namespace NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

public record ServiceBCommand : Command
{
    public string Foo { get; init; }

    [JsonConstructor]
    public ServiceBCommand(string foo) : base()
    {
        Foo = foo;
    }

    public ServiceBCommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}