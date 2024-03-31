using System.Text.Json.Serialization;

namespace NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

public record ServiceACommand : Command
{
    public string Foo { get; init; }

    [JsonConstructor]
    public ServiceACommand(string foo) : base()
    {
        Foo = foo;
    }

    public ServiceACommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}