using System.Text.Json.Serialization;
using NEvo.Messaging.Attributes;

namespace NEvo.ExampleApp.ExampleDomain;

public record MyCommand : Command
{
    public string Foo { get; init; }

    [JsonConstructor]
    public MyCommand(string foo) : base()
    {
        Foo = foo;
    }

    public MyCommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}

[ExternalMessage]
public record MyExternalCommand : Command
{
    public string Foo { get; init; }

    [JsonConstructor]
    public MyExternalCommand(string foo) : base()
    {
        Foo = foo;
    }

    public MyExternalCommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}