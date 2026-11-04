// Mini sistema de biblioteca — exemplo de C# para o Fullpad.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace Fullpad.Exemplos.Biblioteca;

public enum Genero { Romance, Ficcao, Tecnico, Biografia, Poesia }

public record Livro(string Isbn, string Titulo, string Autor, int Ano, Genero Genero, decimal Preco);

public record Emprestimo(Livro Livro, string Leitor, DateOnly Retirada, DateOnly? Devolucao = null)
{
    public bool EmAberto => Devolucao is null;
    public int DiasDeAtraso(DateOnly hoje) =>
        EmAberto ? Math.Max(0, hoje.DayNumber - Retirada.AddDays(14).DayNumber) : 0;
}

public interface IAcervo
{
    IReadOnlyList<Livro> Todos { get; }
    Livro? Buscar(string isbn);
    void Adicionar(Livro livro);
}

public sealed class AcervoEmMemoria : IAcervo
{
    private readonly Dictionary<string, Livro> _livros = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<Livro> Todos => _livros.Values.OrderBy(l => l.Titulo).ToList();

    public Livro? Buscar(string isbn) => _livros.TryGetValue(isbn, out var l) ? l : null;

    public void Adicionar(Livro livro)
    {
        if (!_livros.TryAdd(livro.Isbn, livro))
            throw new InvalidOperationException($"ISBN {livro.Isbn} já cadastrado.");
    }
}

public class LivroIndisponivelException(string titulo) : Exception($"O livro \"{titulo}\" já está emprestado.");

public class Biblioteca(IAcervo acervo)
{
    private readonly List<Emprestimo> _emprestimos = [];

    public event EventHandler<Emprestimo>? Emprestado;

    public Emprestimo Emprestar(string isbn, string leitor, DateOnly hoje)
    {
        var livro = acervo.Buscar(isbn) ?? throw new KeyNotFoundException($"ISBN {isbn} não existe.");
        if (_emprestimos.Any(e => e.Livro == livro && e.EmAberto))
            throw new LivroIndisponivelException(livro.Titulo);

        var emprestimo = new Emprestimo(livro, leitor, hoje);
        _emprestimos.Add(emprestimo);
        Emprestado?.Invoke(this, emprestimo);
        return emprestimo;
    }

    public void Devolver(string isbn, DateOnly hoje)
    {
        var i = _emprestimos.FindIndex(e => e.Livro.Isbn == isbn && e.EmAberto);
        if (i < 0) return;
        _emprestimos[i] = _emprestimos[i] with { Devolucao = hoje };
    }

    public IEnumerable<IGrouping<string, Emprestimo>> AtrasadosPorLeitor(DateOnly hoje) =>
        _emprestimos.Where(e => e.DiasDeAtraso(hoje) > 0).GroupBy(e => e.Leitor);

    public async Task<decimal> TotalMultasAsync(DateOnly hoje)
    {
        await Task.Delay(10); // finge consultar um serviço de cobrança
        return _emprestimos.Sum(e => e.DiasDeAtraso(hoje) * 0.75m);
    }
}

public static class Programa
{
    public static async Task Main()
    {
        IAcervo acervo = new AcervoEmMemoria();
        foreach (var l in new Livro[]
        {
            new("978-85-359-0277-5", "Dom Casmurro", "Machado de Assis", 1899, Genero.Romance, 39.90m),
            new("978-85-254-2051-1", "Memórias Póstumas de Brás Cubas", "Machado de Assis", 1881, Genero.Romance, 42.50m),
            new("978-85-7608-123-4", "Código Limpo", "Robert C. Martin", 2008, Genero.Tecnico, 119.00m),
            new("978-85-325-1018-6", "Poemas Escolhidos", "Cecília Meireles", 1994, Genero.Poesia, 54.00m),
        })
            acervo.Adicionar(l);

        var biblioteca = new Biblioteca(acervo);
        biblioteca.Emprestado += (_, e) => Console.WriteLine($"📚 {e.Leitor} levou \"{e.Livro.Titulo}\"");

        var hoje = DateOnly.FromDateTime(DateTime.Today);
        biblioteca.Emprestar("978-85-359-0277-5", "Ana", hoje.AddDays(-20));
        biblioteca.Emprestar("978-85-7608-123-4", "Bruno", hoje.AddDays(-3));

        try
        {
            biblioteca.Emprestar("978-85-359-0277-5", "Carla", hoje);
        }
        catch (LivroIndisponivelException ex)
        {
            Console.WriteLine($"Aviso: {ex.Message}");
        }

        foreach (var grupo in biblioteca.AtrasadosPorLeitor(hoje))
            Console.WriteLine($"{grupo.Key} tem {grupo.Count()} livro(s) atrasado(s)");

        Console.WriteLine($"Multas: {await biblioteca.TotalMultasAsync(hoje):C}");

        var porGenero = acervo.Todos
            .GroupBy(l => l.Genero)
            .ToDictionary(g => g.Key, g => g.Select(l => l.Titulo).ToArray());
        Console.WriteLine(JsonSerializer.Serialize(porGenero, new JsonSerializerOptions { WriteIndented = true }));

        string descricao = acervo.Todos.Count switch
        {
            0 => "vazio",
            < 5 => "pequeno",
            < 50 => "médio",
            _ => "grande",
        };
        Console.WriteLine($"O acervo é {descricao}.");
    }
}
